package com.weav.workflow.architecture;

import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.weav.workflow")
public class WorkflowCleanArchitectureTest {
    @ArchTest
    public static final ArchRule domain_should_not_depend_on_frameworks_or_http =
            noClasses().that().resideInAPackage("..domain..")
                    .should().dependOnClassesThat().resideInAnyPackage(
                            "org.springframework..",
                            "jakarta.persistence..",
                            "org.hibernate..",
                            "tools.jackson..",
                            "com.rabbitmq..",
                            "jakarta.servlet..",
                            "jakarta.ws.rs..",
                            "javax.servlet..",
                            "javax.ws.rs..",
                            "org.apache.http..",
                            "org.apache.hc..",
                            "okhttp3..",
                            "retrofit2..",
                            "feign..",
                            "java.net.http..");

    @ArchTest
    public static final ArchRule application_should_not_depend_on_infrastructure_or_presentation =
            noClasses().that().resideInAPackage("..application..")
                    .should().dependOnClassesThat().resideInAnyPackage("..infrastructure..", "..presentation..")
                    .allowEmptyShould(true);
}
