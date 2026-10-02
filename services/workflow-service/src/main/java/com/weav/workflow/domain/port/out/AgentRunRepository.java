package com.weav.workflow.domain.port.out;

import com.weav.workflow.domain.model.aggregate.agent.AgentRun;
import java.util.Optional;
import java.util.UUID;

public interface AgentRunRepository { AgentRun save(AgentRun run); Optional<AgentRun> findById(UUID id); }