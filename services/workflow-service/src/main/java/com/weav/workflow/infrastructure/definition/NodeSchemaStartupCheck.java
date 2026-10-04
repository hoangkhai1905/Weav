package com.weav.workflow.infrastructure.definition;

import com.weav.workflow.domain.definition.NodeConfigSchemas;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;

/** Loads the node config schemas at startup so a broken schema set stops the service instead of the first request. */
@Component
class NodeSchemaStartupCheck implements InitializingBean {
    @Override
    public void afterPropertiesSet() {
        NodeConfigSchemas.all();
    }
}
