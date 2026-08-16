import {
  inspectUnsafeVueHtml,
  VUE_NO_V_HTML_RULE,
} from '../../policies/vue-unsafe-html.js';
import {
  inspectVueTargetBlank,
  VUE_TARGET_BLANK_RULE,
} from '../../policies/vue-target-blank.js';
import { defineVuePolicyGate } from '../vue-policy-gate.js';

export const unsafeHtmlGate = defineVuePolicyGate({
  id: 'security.vue-unsafe-html', rule: VUE_NO_V_HTML_RULE,
  inspect: inspectUnsafeVueHtml,
  remediation: 'Replace v-html with Vue templates, components, interpolation, or textContent; if trusted rich HTML is essential, establish a reviewed sanitization boundary.',
  summary: 'Vue v-html gate', manualCommand: 'unsafe-html', manualOrder: 80, doctorOrder: 80,
});

export const targetBlankGate = defineVuePolicyGate({
  id: 'security.vue-target-blank', rule: VUE_TARGET_BLANK_RULE,
  inspect: inspectVueTargetBlank,
  remediation: 'Use a statically verifiable rel="noopener noreferrer" on the same target="_blank" element.',
  summary: 'Vue target=_blank gate', manualCommand: 'target-blank', manualOrder: 90, doctorOrder: 90,
});

export const vueSecurityGates = Object.freeze([unsafeHtmlGate, targetBlankGate]);
