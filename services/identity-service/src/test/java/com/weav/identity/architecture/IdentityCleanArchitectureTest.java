package com.weav.identity.architecture;

import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.weav.identity")
public class IdentityCleanArchitectureTest {
    @ArchTest
    public static final ArchRule domain_should_not_depend_on_frameworks =
            noClasses().that().resideInAPackage("..domain..")
                    .should().dependOnClassesThat().resideInAnyPackage(
                            "org.springframework..", "jakarta.persistence..", "org.hibernate..");

    @ArchTest
    public static final ArchRule domain_should_only_be_accessed_by_allowed_layers =
            classes().that().resideInAPackage("..domain..")
                    .should().onlyBeAccessed().byAnyPackage(
                            "..domain..", "..application..", "..infrastructure..", "..presentation..", "..identity");
}