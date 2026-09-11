import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

export function extendedPom({ jacoco = true } = {}) {
  const cached = pathToFileURL(path.join(os.homedir(), ".m2/repository")).href;
  return `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>java-extended-fixture</artifactId><version>1.0.0</version>
<properties><maven.compiler.release>17</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
<dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.2</version><scope>test</scope></dependency><dependency><groupId>com.tngtech.archunit</groupId><artifactId>archunit</artifactId><version>1.3.0</version><scope>test</scope></dependency></dependencies>
<build><plugins>
<plugin><artifactId>maven-clean-plugin</artifactId><version>3.2.0</version></plugin><plugin><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin><plugin><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin><plugin><artifactId>maven-surefire-plugin</artifactId><version>3.2.5</version></plugin><plugin><artifactId>maven-jar-plugin</artifactId><version>3.4.1</version></plugin>
${jacoco ? "<plugin><groupId>org.jacoco</groupId><artifactId>jacoco-maven-plugin</artifactId><version>0.8.12</version><executions><execution><goals><goal>prepare-agent</goal></goals></execution><execution><id>coverage-report</id><phase>verify</phase><goals><goal>report</goal></goals></execution></executions></plugin>" : ""}
</plugins></build>
<repositories><repository><id>fixture-cached-local</id><url>${cached}</url></repository><repository><id>Central Repository</id><url>https://repo.maven.apache.org/maven2</url></repository><repository><id>mirror</id><url>https://repo.maven.apache.org/maven2</url></repository></repositories>
<pluginRepositories><pluginRepository><id>fixture-cached-local</id><url>${cached}</url></pluginRepository><pluginRepository><id>Central Repository</id><url>https://repo.maven.apache.org/maven2</url></pluginRepository><pluginRepository><id>mirror</id><url>https://repo.maven.apache.org/maven2</url></pluginRepository></pluginRepositories></project>`;
}
export function writeExtendedFixture(root) {
  for (const directory of [
    "src/main/java/example/service",
    "src/main/java/example/controller",
    "src/test/java/example",
  ])
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(path.join(root, "pom.xml"), extendedPom());
  fs.writeFileSync(
    path.join(root, "src/main/java/example/service/App.java"),
    "package example.service; public class App { public int value(boolean positive) { if (positive) return 7; return -7; } }",
  );
  fs.writeFileSync(
    path.join(root, "src/main/java/example/controller/Web.java"),
    "package example.controller; public class Web { public int value() { return new example.service.App().value(true); } }",
  );
  fs.writeFileSync(
    path.join(root, "src/test/java/example/AppTest.java"),
    "package example; public class AppTest { @org.junit.jupiter.api.Test public void value() { org.junit.jupiter.api.Assertions.assertEquals(7, new example.controller.Web().value()); } }",
  );
  fs.writeFileSync(
    path.join(root, "src/test/java/example/ArchitectureTest.java"),
    'package example; public class ArchitectureTest { @org.junit.jupiter.api.Test public void layers() { com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses().that().resideInAPackage("..service..").should().dependOnClassesThat().resideInAPackage("..controller..").check(new com.tngtech.archunit.core.importer.ClassFileImporter().importPackages("example.service", "example.controller")); } }',
  );
}
