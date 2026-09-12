package com.weav.workspace.architecture;

import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.weav.workspace.domain")
class WorkspaceDomainArchitectureTest {

    @ArchTest
    static final ArchRule domainDoesNotDependOnSpringOrJpa = noClasses()
            .should()
            .dependOnClassesThat()
            .resideInAnyPackage("org.springframework..", "jakarta.persistence..");
}
