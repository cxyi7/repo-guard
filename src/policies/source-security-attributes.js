import { forbiddenScheme, windowProtection } from './source-security-syntax.js';

/** 属性值为 null 表示源码不是直接字符串；不会读取绑定变量或执行表达式。 */
export function inspectSecurityAttributes(
  tag,
  attributes,
  options,
  add,
  { vue = false, native = true, spread = false } = {},
) {
  const enabled = (group, key) => options[group].enabled && options[group][key];
  const unknown = (attr, message) =>
    add('source-security/unconfirmed', attr.offset, message, true);
  for (const attr of attributes) {
    if (vue && attr.name === 'v-html' && enabled('htmlInjection', 'vueVHtml'))
      add(
        'vue/no-v-html',
        attr.offset,
        '禁止使用 Vue v-html 指令，不推测输入内容或净化函数的安全性。',
      );
    if (!native) continue;
    if (
      tag === 'iframe' &&
      attr.name === 'srcdoc' &&
      enabled('htmlInjection', 'iframeSrcdoc')
    )
      add(
        'source-security/srcdoc',
        attr.offset,
        '禁止通过 iframe srcdoc 嵌入 HTML。',
      );
    if (
      /^on[a-z]+$/.test(attr.name) &&
      !attr.eventHandler &&
      enabled('inlineEventCode', 'htmlEventAttributes')
    )
      add(
        'source-security/inline-event',
        attr.offset,
        '禁止使用 HTML on* 内联事件属性。',
      );
    const navigation =
      (['a', 'area', 'base'].includes(tag) && attr.name === 'href') ||
      (tag === 'form' && attr.name === 'action') ||
      (['button', 'input'].includes(tag) && attr.name === 'formaction') ||
      (['iframe', 'frame'].includes(tag) && attr.name === 'src');
    const script = tag === 'script' && attr.name === 'src';
    if (
      (navigation && enabled('urlScheme', 'navigation')) ||
      (script && enabled('urlScheme', 'scriptSource'))
    ) {
      if (attr.value === null)
        unknown(attr, '地址使用动态表达式，未推导或确认协议。');
      else if (forbiddenScheme(attr.value, script))
        add(
          'source-security/url-scheme',
          attr.offset,
          '地址字面量使用了配置禁止的协议。',
        );
    }
  }
  if (
    !native ||
    !['a', 'area', 'form'].includes(tag) ||
    !options.newWindow.enabled
  )
    return;
  const target = attributes.find((attr) => attr.name === 'target');
  if (!target) return;
  if (target.value === null) {
    unknown(target, 'target 使用动态表达式，未确认是否打开新窗口。');
    return;
  }
  if (target.value.toLowerCase() !== '_blank') return;
  const rel = attributes.find((attr) => attr.name === 'rel');
  if (spread || rel?.value === null) {
    unknown(target, '新窗口的 rel 含动态值或属性展开，未确认保护选项。');
    return;
  }
  if (windowProtection(rel?.value ?? '', options.newWindow))
    add(
      vue ? 'vue/target-blank-security' : 'source-security/new-window',
      target.offset,
      '新窗口的显式 rel 保护选项不符合配置。',
    );
}
