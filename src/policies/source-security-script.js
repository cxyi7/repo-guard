import traverseModule from '@babel/traverse';
import { parserOptions } from '@vue/compiler-dom';
import { inspectSecurityAttributes } from './source-security-attributes.js';
import {
  globalApi,
  globalIdentifier,
  globalMember,
  literalString,
  memberName,
  parseSecurityScript,
  forbiddenScheme,
  windowProtection,
} from './source-security-syntax.js';

const traverse = traverseModule.default ?? traverseModule;
const MEMBER_TYPES = ['MemberExpression', 'OptionalMemberExpression'];

function documentObject(node, scope) {
  return (
    globalIdentifier(node, scope, ['document']) ||
    globalMember(node, scope, ['document'])
  );
}

/** 仅支持直接书写的浏览器内建访问，不沿变量、调用返回值或自定义组件追踪。 */
function domExpression(node, scope) {
  return (
    MEMBER_TYPES.includes(node?.type) &&
    documentObject(node.object, scope) &&
    ['body', 'head', 'documentElement'].includes(memberName(node))
  );
}

function windowObject(node, scope) {
  return (
    globalIdentifier(node, scope, ['window']) ||
    globalMember(node, scope, ['parent', 'top', 'opener'], ['window'])
  );
}

function typeReference(p) {
  return p.findParent(
    (parent) =>
      parent.node.type.startsWith('TS') &&
      ![
        'TSAsExpression',
        'TSSatisfiesExpression',
        'TSNonNullExpression',
        'TSTypeAssertion',
        'TSInstantiationExpression',
      ].includes(parent.node.type),
  );
}

export function inspectSecurityScript(
  source,
  filename,
  options,
  add,
  language = '',
) {
  const ast = parseSecurityScript(source, filename, language);
  const active = (group, key) => options[group].enabled && options[group][key];
  const unknown = (node, message) =>
    add('source-security/unconfirmed', node.start, message, true);
  const dynamicReference = (node, name) => {
    if (name === 'eval' && active('dynamicCode', 'eval'))
      add('security/no-eval', node.start, '源码使用了全局 eval。');
    if (name === 'Function' && active('dynamicCode', 'functionConstructors'))
      add(
        'security/no-function-constructor',
        node.start,
        '源码使用了全局 Function 构造器。',
      );
  };
  const inspectMember = (p) => {
    if (typeReference(p)) return;
    if (
      globalMember(
        p.node,
        p.scope,
        ['eval', 'Function'],
        ['window', 'globalThis', 'self', 'global'],
      )
    )
      dynamicReference(p.node.property, memberName(p.node));
  };
  const inspectCall = (p) => {
    const { node, scope } = p;
    const callee = node.callee;
    const args = node.arguments;
    const name = memberName(callee);
    if (args.some((arg) => arg.type === 'SpreadElement')) {
      if (
        (globalApi(callee, scope, ['setTimeout', 'setInterval']) &&
          active('dynamicCode', 'stringTimers')) ||
        (globalMember(callee, scope, ['open'], ['window']) &&
          active('newWindow', 'checkWindowOpen')) ||
        (name === 'postMessage' && options.crossWindowMessage.enabled)
      ) {
        unknown(node, '敏感调用含展开参数，未推导实际参数和值。');
        return;
      }
    }
    if (
      active('dynamicCode', 'stringTimers') &&
      globalApi(callee, scope, ['setTimeout', 'setInterval'])
    ) {
      if (literalString(args[0]) !== null)
        add(
          'source-security/string-timer',
          node.start,
          '定时器处理器不得使用字符串字面量。',
        );
      else if (
        args[0] &&
        !['ArrowFunctionExpression', 'FunctionExpression'].includes(
          args[0].type,
        )
      )
        unknown(args[0], '定时器处理器不是直接函数表达式，未推导其类型。');
    }
    if (active('htmlInjection', 'domHtmlWrites')) {
      if (
        documentObject(callee?.object, scope) &&
        ['write', 'writeln'].includes(name)
      )
        add(
          'source-security/dom-html',
          node.start,
          '禁止直接调用 document.write/writeln 写入 HTML。',
        );
      if (name === 'insertAdjacentHTML') {
        if (domExpression(callee.object, scope)) {
          if (
            !(
              options.htmlInjection.allowEmptyClear &&
              literalString(args[1]) === ''
            )
          )
            add(
              'source-security/dom-html',
              node.start,
              '禁止通过 insertAdjacentHTML 写入 HTML。',
            );
        } else
          unknown(
            callee,
            'insertAdjacentHTML 的接收对象身份未确认，不判定为 DOM 写入。',
          );
      }
    }
    if (name === 'setAttribute' && literalString(args[0]) !== null) {
      const attribute = literalString(args[0]).toLowerCase();
      if (
        /^on[a-z]+$/.test(attribute) &&
        active('inlineEventCode', 'domEventAttributeWrites')
      ) {
        if (domExpression(callee.object, scope))
          add(
            'source-security/inline-event',
            node.start,
            '禁止通过 setAttribute 写入 on* 事件属性。',
          );
        else unknown(callee, '事件属性写入的接收对象身份未确认。');
      }
    }
    if (
      active('newWindow', 'checkWindowOpen') &&
      globalMember(callee, scope, ['open'], ['window'])
    ) {
      const target = args[1] === undefined ? '_blank' : literalString(args[1]);
      if (target === null)
        unknown(node, 'window.open 的目标是动态表达式，未确认是否新建窗口。');
      else if (target === '' || target.toLowerCase() === '_blank') {
        const features = args[2] === undefined ? '' : literalString(args[2]);
        if (features === null)
          unknown(node, 'window.open 的保护选项不是字面量，未确认。');
        else if (windowProtection(features, options.newWindow, true))
          add(
            'source-security/new-window',
            node.start,
            'window.open 的显式保护选项不符合配置。',
          );
      }
    }
    if (options.crossWindowMessage.enabled && name === 'postMessage') {
      if (!windowObject(callee.object, scope)) {
        unknown(
          callee,
          'postMessage 接收对象身份未确认，未套用 Window 的目标来源规则。',
        );
        return;
      }
      let origin = args[1];
      if (origin?.type === 'ObjectExpression') {
        if (
          origin.properties.some(
            (property) =>
              property.type === 'SpreadElement' || property.computed,
          )
        ) {
          unknown(origin, '消息选项含展开或计算属性，未确认目标来源。');
          return;
        }
        origin = origin.properties.findLast(
          (property) =>
            (property.key?.name ?? literalString(property.key)) ===
            'targetOrigin',
        )?.value;
      }
      if (!origin) {
        if (options.crossWindowMessage.requireExplicitTargetOrigin)
          add(
            'source-security/message-origin',
            node.start,
            'Window.postMessage 必须显式提供 targetOrigin。',
          );
      } else if (literalString(origin) === null)
        unknown(origin, 'targetOrigin 不是字符串字面量，未验证其值。');
      else if (
        literalString(origin) === '*' &&
        options.crossWindowMessage.forbidWildcardTargetOrigin
      )
        add(
          'source-security/message-origin',
          node.start,
          'Window.postMessage 的 targetOrigin 不得使用 *。',
        );
    }
    if (
      options.urlScheme.enabled &&
      options.urlScheme.navigation &&
      documentObject(callee?.object?.object, scope) &&
      memberName(callee.object) === 'location' &&
      ['assign', 'replace'].includes(name) &&
      forbiddenScheme(literalString(args[0]))
    ) {
      add(
        'source-security/url-scheme',
        node.start,
        '导航地址使用了禁止的字面量协议。',
      );
    }
  };
  traverse(ast, {
    JSXOpeningElement(p) {
      const tag = p.node.name.type === 'JSXIdentifier' ? p.node.name.name : '';
      const spread = p.node.attributes.some(
        (attr) => attr.type === 'JSXSpreadAttribute',
      );
      const attributes = p.node.attributes
        .filter(
          (attr) =>
            attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier',
        )
        .map((attr) => {
          const expression =
            attr.value?.type === 'JSXExpressionContainer'
              ? attr.value.expression
              : attr.value;
          return {
            name: attr.name.name.toLowerCase(),
            value: literalString(expression),
            offset: attr.start,
            eventHandler:
              /^on[A-Z]/.test(attr.name.name) &&
              literalString(expression) === null,
          };
        });
      inspectSecurityAttributes(tag, attributes, options, add, {
        native: Boolean(tag) && parserOptions.isNativeTag(tag),
        spread,
      });
      if (spread) unknown(p.node, 'JSX 属性展开内容未检查，不推导运行时属性。');
    },
    Identifier(p) {
      if (
        !typeReference(p) &&
        p.isReferencedIdentifier() &&
        globalIdentifier(p.node, p.scope, ['eval', 'Function'])
      )
        dynamicReference(p.node, p.node.name);
    },
    MemberExpression: inspectMember,
    OptionalMemberExpression: inspectMember,
    CallExpression: inspectCall,
    OptionalCallExpression: inspectCall,
    AssignmentExpression(p) {
      const { left, right } = p.node;
      const name = memberName(left);
      if (!name) return;
      if (
        active('htmlInjection', 'domHtmlWrites') &&
        ['innerHTML', 'outerHTML'].includes(name)
      ) {
        if (!domExpression(left.object, p.scope))
          unknown(left, 'HTML 属性的接收对象身份未确认，不判定为 DOM 写入。');
        else if (
          !(
            options.htmlInjection.allowEmptyClear &&
            p.node.operator === '=' &&
            literalString(right) === ''
          )
        )
          add(
            'source-security/dom-html',
            left.start,
            '禁止直接向 DOM 的 HTML 属性写入内容。',
          );
      }
      if (
        active('inlineEventCode', 'stringEventPropertyWrites') &&
        /^on[a-z]+$/.test(name) &&
        literalString(right) !== null
      ) {
        if (domExpression(left.object, p.scope))
          add(
            'source-security/inline-event',
            left.start,
            '禁止向 DOM 事件属性写入字符串。',
          );
        else unknown(left, '字符串事件属性的接收对象身份未确认。');
      }
    },
  });
}
