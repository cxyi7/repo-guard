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
  remediation: '使用 Vue 模板、组件、插值或 textContent 替代 v-html；如果必须使用可信富文本 HTML，请建立经过审查的净化边界。',
  summary: 'Vue v-html 门禁', manualCommand: 'unsafe-html', manualOrder: 80, doctorOrder: 80,
});

export const targetBlankGate = defineVuePolicyGate({
  id: 'security.vue-target-blank', rule: VUE_TARGET_BLANK_RULE,
  inspect: inspectVueTargetBlank,
  remediation: '在同一个 target="_blank" 元素上使用可静态校验的 rel="noopener noreferrer"。',
  summary: 'Vue target=_blank 门禁', manualCommand: 'target-blank', manualOrder: 90, doctorOrder: 90,
});

export const vueSecurityGates = Object.freeze([unsafeHtmlGate, targetBlankGate]);
