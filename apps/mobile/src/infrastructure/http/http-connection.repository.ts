import type {
  ConnectionItem,
  ConnectionRepository,
  ConnectionTestOutcome,
} from '../../domain/connection/connection.types';
import {
  buildConnectionDetailRequest,
  buildConnectionListRequest,
  buildDisableConnectionRequest,
  buildTestConnectionRequest,
} from './connection.http.contract';
import { mapConnection, mapConnectionList, mapConnectionTestOutcome } from './connection.mapper';
import { requestGateway } from './gateway-request';

export class HttpConnectionRepository implements ConnectionRepository {
  getConnections(workspaceId: string): Promise<ConnectionItem[]> {
    return requestGateway(buildConnectionListRequest(workspaceId), mapConnectionList);
  }

  getConnection(workspaceId: string, connectionId: string): Promise<ConnectionItem> {
    return requestGateway(buildConnectionDetailRequest(workspaceId, connectionId), mapConnection);
  }

  testConnection(workspaceId: string, connectionId: string): Promise<ConnectionTestOutcome> {
    return requestGateway(
      buildTestConnectionRequest(workspaceId, connectionId),
      mapConnectionTestOutcome,
    );
  }

  disableConnection(workspaceId: string, connectionId: string): Promise<ConnectionItem> {
    return requestGateway(buildDisableConnectionRequest(workspaceId, connectionId), mapConnection);
  }
}
