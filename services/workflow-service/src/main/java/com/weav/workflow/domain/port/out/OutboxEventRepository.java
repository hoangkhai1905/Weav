package com.weav.workflow.domain.port.out;

import com.weav.workflow.domain.model.aggregate.workflow.OutboxEvent;
import java.util.List;

public interface OutboxEventRepository { OutboxEvent save(OutboxEvent event); List<OutboxEvent> findPending(int limit); }