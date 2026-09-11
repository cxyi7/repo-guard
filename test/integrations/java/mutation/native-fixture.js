import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function nativeMutationPom() {
  const cached = pathToFileURL(path.join(os.homedir(), '.m2/repository')).href;
  return `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>pit-fixture</artifactId><version>1.0.0</version>
<properties><maven.compiler.release>17</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
<dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.2</version><scope>test</scope></dependency></dependencies>
<build><plugins>
<plugin><artifactId>maven-clean-plugin</artifactId><version>3.2.0</version></plugin><plugin><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin><plugin><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin><plugin><artifactId>maven-surefire-plugin</artifactId><version>3.2.5</version></plugin><plugin><artifactId>maven-help-plugin</artifactId><version>3.5.1</version></plugin>
<plugin><groupId>org.pitest</groupId><artifactId>pitest-maven</artifactId><version>1.17.3</version><configuration><parseSurefireConfig>false</parseSurefireConfig></configuration><dependencies><dependency><groupId>org.pitest</groupId><artifactId>pitest-junit5-plugin</artifactId><version>1.2.2</version></dependency></dependencies></plugin>
</plugins></build>
<repositories><repository><id>fixture-cached-local</id><url>${cached}</url></repository><repository><id>Central Repository</id><url>https://repo.maven.apache.org/maven2</url></repository><repository><id>mirror</id><url>https://repo.maven.apache.org/maven2</url></repository></repositories>
<pluginRepositories><pluginRepository><id>fixture-cached-local</id><url>${cached}</url></pluginRepository><pluginRepository><id>Central Repository</id><url>https://repo.maven.apache.org/maven2</url></pluginRepository><pluginRepository><id>mirror</id><url>https://repo.maven.apache.org/maven2</url></pluginRepository></pluginRepositories></project>`;
}
export function writeNativeMutationFixture(root, { broken = false, skipped = false } = {}) {
  fs.mkdirSync(path.join(root, 'src/main/java/example'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/test/java/example'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pom.xml'), nativeMutationPom());
  fs.writeFileSync(path.join(root, 'src/main/java/example/App.java'), 'package example; public class App { public int value(int number) { if (number >= 0) return number + 1; return -number; } }');
  fs.writeFileSync(path.join(root, 'src/test/java/example/AppTest.java'), `package example; public class AppTest { ${skipped ? '@org.junit.jupiter.api.Disabled ' : ''}@org.junit.jupiter.api.Test public void value() { org.junit.jupiter.api.Assertions.assertEquals(${broken ? 999 : 3}, new App().value(2)); } }`);
}
