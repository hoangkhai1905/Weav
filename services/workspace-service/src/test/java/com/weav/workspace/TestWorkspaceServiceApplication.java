package com.weav.workspace;

import org.springframework.boot.SpringApplication;

public class TestWorkspaceServiceApplication {

	public static void main(String[] args) {
		SpringApplication.from(WorkspaceServiceApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}

