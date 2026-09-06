(function initAutofillExecutor(root, factory) {
  const exported = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (root) root.AutofillExecutor = exported;
})(typeof globalThis !== 'undefined' ? globalThis : null, () => {
  'use strict';

  function ownValue(object, key) {
    if (!object || !Object.prototype.hasOwnProperty.call(object, key)) return undefined;
    return object[key];
  }

  function resolveValue(profile, field) {
    // Use structured schema keys, not eval or a parser for user-defined path strings.
    const section = ownValue(profile, field.section);
    const entry = field.repeatIndex === null || field.repeatIndex === undefined
      ? section : Array.isArray(section) ? ownValue(section, field.repeatIndex) : undefined;
    const value = ownValue(entry, field.label);
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
    return '';
  }

  async function executeTextMappings({ plan, bindings, profileSchema, profile, documentRef, pageUrl, isCurrentSession = () => true }) {
    const profileById = new Map(profileSchema.map(field => [field.id, field]));
    const candidates = Array.isArray(plan?.mappings) ? plan.mappings : [];
    const sourcesByPage = new Map();
    for (const mapping of candidates) {
      if (!sourcesByPage.has(mapping.pageFieldId)) sourcesByPage.set(mapping.pageFieldId, new Set());
      sourcesByPage.get(mapping.pageFieldId).add(mapping.profileFieldId);
    }
    const results = [];
    const seen = new Set();
    const written = [];
    const view = documentRef.defaultView;
    const samePage = () => documentRef.location.href === pageUrl && isCurrentSession();

    for (const mapping of candidates) {
      if (seen.has(mapping.pageFieldId)) continue;
      seen.add(mapping.pageFieldId);
      const result = { pageFieldId: mapping.pageFieldId, status: 'skipped', reason: '' };
      results.push(result);
      try {
        const binding = bindings.get(mapping.pageFieldId);
        const element = binding?.element;
        const field = profileById.get(mapping.profileFieldId);
        if (!binding || !field) { result.reason = 'unknown_field'; continue; }
        if (sourcesByPage.get(mapping.pageFieldId).size > 1) { result.reason = 'conflicting_sources'; continue; }
        const textarea = element instanceof view.HTMLTextAreaElement;
        const textInput = element instanceof view.HTMLInputElement && ['text', 'email', 'tel', 'url', 'search'].includes(element.type);
        if (!textarea && !textInput) { result.reason = 'unsupported_control'; continue; }
        if (!samePage() || !binding.isCurrent()) { result.reason = 'field_changed'; continue; }
        if (String(element.value).trim()) { result.reason = 'existing_value'; continue; }
        const value = resolveValue(profile, field);
        if (!value.trim()) { result.reason = 'missing_value'; continue; }

        const prototype = textarea ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (!setter) { result.status = 'failed'; result.reason = 'write_failed'; continue; }
        setter.call(element, value);
        element.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
        // A site may replace a control during its input handler.
        if (!samePage() || !binding.isCurrent()) { result.status = 'failed'; result.reason = 'field_changed'; continue; }
        element.dispatchEvent(new view.Event('change', { bubbles: true, composed: true }));
        await new Promise(resolve => setTimeout(resolve, 60));
        written.push({ result, binding, value });
      } catch (_) {
        result.status = 'failed';
        result.reason = 'write_failed';
      }
    }

    // Recheck all written controls after dependent fields and framework updates settle.
    for (const { result, binding, value } of written) {
      try {
        const current = samePage() && binding.isCurrent();
        result.status = current && binding.element.value === value ? 'filled' : 'failed';
        result.reason = !current ? 'field_changed' : result.status === 'filled' ? '' : 'value_mismatch';
      } catch (_) {
        result.status = 'failed';
        result.reason = 'write_failed';
      }
    }
    return {
      results,
      filled: results.filter(item => item.status === 'filled').length,
      skipped: results.filter(item => item.status === 'skipped').length,
      failed: results.filter(item => item.status === 'failed').length
    };
  }

  return { executeTextMappings };
});
