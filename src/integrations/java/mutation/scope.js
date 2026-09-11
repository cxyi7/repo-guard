import { PIT_SCOPE_LIMITS } from '../../../config/java-mutation.js';
import { executionError } from '../../../core/error/repo-guard-error.js';

// 只解释字面字符和星号，通过动态规划匹配，不把用户输入转换成回溯正则。
function matchPattern(value, pattern) {
  let previous = new Uint8Array(pattern.length + 1);
  previous[0] = 1;
  for (let index = 1; index <= pattern.length; index++) previous[index] = previous[index - 1] && pattern[index - 1] === '*';
  for (const character of value) {
    const current = new Uint8Array(pattern.length + 1);
    for (let index = 1; index <= pattern.length; index++) {
      current[index] = pattern[index - 1] === '*' ? current[index - 1] || previous[index] : previous[index - 1] && pattern[index - 1] === character;
    }
    previous = current;
  }
  return Boolean(previous[pattern.length]);
}
export function createPitClassMatcher(patterns) {
  if (!Array.isArray(patterns) || !patterns.length || patterns.length > PIT_SCOPE_LIMITS.patterns || patterns.some((pattern) => typeof pattern !== 'string' || !pattern.length || pattern.length > PIT_SCOPE_LIMITS.patternLength) || patterns.reduce((total, pattern) => total + pattern.length, 0) > PIT_SCOPE_LIMITS.totalPatternLength) throw executionError('java/pit-scope-limit', 'PIT 类名匹配模式超过支持上限');
  let remaining = PIT_SCOPE_LIMITS.matchingSteps;
  const cache = new Map();
  return (className) => {
    if (typeof className !== 'string' || !className.length || className.length > PIT_SCOPE_LIMITS.classNameLength) throw executionError('java/pit-classname-limit', 'PIT 原生类名为空或超过 1024 字符');
    if (cache.has(className)) return cache.get(className);
    const found = patterns.some((pattern) => {
      remaining -= className.length * pattern.length;
      if (remaining < 0) throw executionError('java/pit-scope-limit', 'PIT 类名匹配超过本模块计算预算，请收窄模式或分拆检查模块');
      return matchPattern(className, pattern);
    });
    cache.set(className, found);
    return found;
  };
}
export function matchesPitClass(className, patterns) { return createPitClassMatcher(patterns)(className); }
