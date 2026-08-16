import {
  inspectVueFormLabels,
  VUE_FORM_CONTROL_LABEL_RULE,
} from '../../policies/vue-form-label.js';
import {
  inspectVueImageAlts,
  VUE_IMAGE_ALT_RULE,
} from '../../policies/vue-image-alt.js';
import { defineVuePolicyGate } from '../vue-policy-gate.js';

export const formLabelGate = defineVuePolicyGate({
  id: 'accessibility.vue-form-label', rule: VUE_FORM_CONTROL_LABEL_RULE,
  inspect: inspectVueFormLabels,
  summary: 'Vue 表单标签门禁', manualCommand: 'form-labels', manualOrder: 100, doctorOrder: 100,
});

export const imageAltGate = defineVuePolicyGate({
  id: 'accessibility.vue-image-alt', rule: VUE_IMAGE_ALT_RULE,
  inspect: inspectVueImageAlts,
  summary: 'Vue 图片替代文本门禁', manualCommand: 'image-alt', manualOrder: 110, doctorOrder: 110,
});

export const vueAccessibilityGates = Object.freeze([formLabelGate, imageAltGate]);
