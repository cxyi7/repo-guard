import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateJavaSpotbugsChecks } from '../../../../src/config/java-spotbugs.js';

export function spotbugsXml({ bugs = [], classes = ['example.App'], timestamp = Date.now(), errors = 0, missingClasses = 0 } = {}) {
  return `<BugCollection version="4.10.3" analysisTimestamp="${timestamp}"><Project><Jar>target/classes</Jar></Project>${bugs.map(({ type = 'NP_ALWAYS_NULL', priority = 1 }) => `<BugInstance type="${type}" priority="${priority}"><LongMessage>Null pointer access</LongMessage><SourceLine sourcepath="example/App.java" start="3" primary="true"/></BugInstance>`).join('')}<Errors errors="${errors}" missingClasses="${missingClasses}"/><FindBugsSummary total_classes="${classes.length}" total_bugs="${bugs.length}" priority_1="${bugs.filter((bug) => (bug.priority ?? 1) === 1).length}" priority_2="${bugs.filter((bug) => bug.priority === 2).length}" priority_3="${bugs.filter((bug) => bug.priority === 3).length}"><PackageStats>${classes.map((name) => `<ClassStats class="${name}"/>`).join('')}</PackageStats></FindBugsSummary></BugCollection>`;
}
export function effectivePom(root, directory = '.', configuration = '') {
  const base = path.resolve(root, directory).replaceAll('\\', '/');
  return `<project><packaging>jar</packaging><build><directory>${base}/target</directory><outputDirectory>${base}/target/classes</outputDirectory><sourceDirectory>${base}/src/main/java</sourceDirectory><plugins><plugin><groupId>com.github.spotbugs</groupId><artifactId>spotbugs-maven-plugin</artifactId><version>4.10.3.0</version>${configuration}</plugin></plugins></build></project>`;
}
export function spotbugsFixture(t, directories = ['.']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-spotbugs-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');
  for (const directory of directories) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, directory, 'pom.xml'), '<project/>');
  }
  const config = validateJavaSpotbugsChecks({ javaSpotbugs: {
    enabled: true, pluginVersion: '4.10.3.0', modules: directories.map((directory, index) => ({
      name: `api${index}`, directory, reports: [path.posix.join(directory, 'target/spotbugsXml.xml')],
    })),
  } }).javaSpotbugs;
  const calls = [];
  const execute = async (input) => {
    calls.push(input);
    if (input.goals.includes('help:effective-pom')) {
      const file = input.additional[0].slice('-Doutput='.length);
      const directory = path.posix.dirname(input.config.pom);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, effectivePom(root, directory));
    } else if (input.goals.includes('compile')) {
      for (const module of config.modules) {
        const classes = path.join(root, module.directory, 'target/classes/example');
        fs.mkdirSync(classes, { recursive: true });
        fs.writeFileSync(path.join(classes, 'App.class'), Buffer.from('cafebabe00000000', 'hex'));
        fs.writeFileSync(path.join(root, module.reports[0]), spotbugsXml());
      }
    }
    return { status: 0, stdout: '', stderr: '', goals: input.goals };
  };
  return { root, config, execute, calls };
}
