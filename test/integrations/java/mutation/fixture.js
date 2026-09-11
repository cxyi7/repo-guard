import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateJavaMutationChecks } from '../../../../src/config/java-mutation.js';

export function mutationConfig(overrides = {}) {
  return validateJavaMutationChecks({ javaMutationTest: {
    enabled: true, pluginVersion: '1.17.3', threshold: 80,
    modules: [{ name: 'app', directory: '.', reports: ['target/surefire-reports/TEST-example.AppTest.xml'], mutationReport: 'target/pit-reports/mutations.xml', targetClasses: ['example.*'], targetTests: ['example.*Test'] }], ...overrides,
  } }).javaMutationTest;
}
export function mutationFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo guard pit '));
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
export function writeOutput(root, file, content) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  const time = new Date(Date.now() + 5);
  fs.utimesSync(path.join(root, file), time, time);
}
export function junit({ failed = false, skipped = false, empty = false } = {}) {
  return `<testsuite tests="${empty ? 0 : 1}" failures="${failed ? 1 : 0}" skipped="${skipped ? 1 : 0}">${empty ? '' : `<testcase name="value" classname="example.AppTest">${failed ? '<failure/>' : skipped ? '<skipped/>' : ''}</testcase>`}</testsuite>`;
}
export function mutationXml(status = 'KILLED', index = 0) {
  const detected = ['KILLED', 'TIMED_OUT', 'NON_VIABLE', 'MEMORY_ERROR', 'RUN_ERROR', 'EQUIVALENT'].includes(status);
  const tests = status === 'NO_COVERAGE' ? 0 : 1;
  return `<mutation detected="${detected}" status="${status}" numberOfTestsRun="${tests}"><sourceFile>App.java</sourceFile><mutatedClass>example.App</mutatedClass><mutatedMethod>value</mutatedMethod><methodDescription>()I</methodDescription><lineNumber>3</lineNumber><mutator>org.pitest.mutationtest.engine.gregor.mutators.MathMutator</mutator><indexes><index>${index}</index></indexes><blocks><block>0</block></blocks><killingTest>${status === 'KILLED' ? 'example.AppTest.value(example.AppTest)' : ''}</killingTest><description>replaced value</description></mutation>`;
}
export function pitXml(statuses = ['KILLED']) { return `<mutations partial="true">${statuses.map((status, index) => mutationXml(status, index)).join('')}</mutations>`; }
export function effectivePom(configuration = '<parseSurefireConfig>false</parseSurefireConfig>') {
  return `<project><build><plugins><plugin><groupId>org.pitest</groupId><artifactId>pitest-maven</artifactId><version>1.17.3</version><configuration>${configuration}</configuration></plugin></plugins></build></project>`;
}
export function fakeMaven(root, { baseline = junit(), pit = pitXml(), effective = effectivePom(), statuses = {}, onCall } = {}) {
  return async (input) => {
    onCall?.(input);
    const goal = input.goals.at(-1);
    if (goal === 'test') writeOutput(root, 'target/surefire-reports/TEST-example.AppTest.xml', baseline);
    if (goal === 'help:effective-pom') writeOutput(root, 'target/repo-guard-pit-effective-pom.xml', effective);
    if (goal.includes(':mutationCoverage')) writeOutput(root, 'target/pit-reports/mutations.xml', pit);
    return { status: statuses[goal] ?? 0, stdout: '', stderr: '', goals: input.goals };
  };
}
