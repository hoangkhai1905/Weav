package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.infrastructure.persistence.ConnectionPersistenceExceptionTranslator;
import com.weav.workspace.infrastructure.persistence.mapper.ConnectionPersistenceMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class ConnectionRepositoryAdapter implements ConnectionRepository {

    private final SpringDataConnectionRepository repository;
    private final ConnectionPersistenceMapper mapper;

    @Autowired
    public ConnectionRepositoryAdapter(
            SpringDataConnectionRepository repository,
            ObjectMapper objectMapper) {
        this.repository = repository;
        this.mapper = new ConnectionPersistenceMapper(objectMapper);
    }

    public ConnectionRepositoryAdapter(SpringDataConnectionRepository repository) {
        this(repository, new ObjectMapper());
    }

    @Override
    public Connection save(Connection connection) {
        try {
            return mapper.toDomain(repository.saveAndFlush(mapper.toEntity(connection)));
        } catch (RuntimeException exception) {
            throw ConnectionPersistenceExceptionTranslator.translate(exception);
        }
    }

    @Override
    public Optional<Connection> findById(UUID id) {
        return repository.findById(id).map(mapper::toDomain);
    }

    @Override
    public Optional<Connection> findByWorkspaceIdAndId(UUID workspaceId, UUID connectionId) {
        return repository.findByWorkspaceIdAndId(workspaceId, connectionId).map(mapper::toDomain);
    }

    @Override
    public List<Connection> findAllByWorkspaceId(UUID workspaceId) {
        return repository.findAllByWorkspaceId(workspaceId).stream()
                .map(mapper::toDomain)
                .toList();
    }

    @Override
    public boolean existsByWorkspaceIdAndNameNormalized(
            UUID workspaceId,
            String normalizedName,
            UUID excludingConnectionId) {
        return repository.existsByWorkspaceIdAndNameNormalized(
                workspaceId,
                normalizedName,
                excludingConnectionId);
    }

    @Override
    public void delete(Connection connection) {
        repository.deleteById(connection.getId());
        repository.flush();
    }
}
