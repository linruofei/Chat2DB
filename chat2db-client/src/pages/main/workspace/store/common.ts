import { IConnectionListItem } from '@/typings/connection';
import { useWorkspaceStore } from './index';
import { DatabaseTypeCode } from '@/constants';

export interface ICommonStore {
  currentConnectionDetails: IConnectionListItem | null;
  currentWorkspaceExtend: string | null;
  currentWorkspaceGlobalExtend: {
    code: string,
    uniqueData: any,
  } | null;
  preloadTreeTablesTarget: {
    requestId: number;
    dataSourceId: number;
    databaseType: DatabaseTypeCode;
    dataSourceName?: string;
    databaseName?: string;
    schemaName?: string;
  } | null;
}

export const initCommonStore: ICommonStore = {
  currentConnectionDetails: null,
  currentWorkspaceExtend: null,
  currentWorkspaceGlobalExtend: null,
  preloadTreeTablesTarget: null,
}

export const setCurrentConnectionDetails = (connectionDetails: ICommonStore['currentConnectionDetails']) => {
  return useWorkspaceStore.setState({ currentConnectionDetails: connectionDetails });
}

export const setCurrentWorkspaceExtend = (workspaceExtend: ICommonStore['currentWorkspaceExtend']) => {
  return useWorkspaceStore.setState({ currentWorkspaceExtend: workspaceExtend });
}

export const setCurrentWorkspaceGlobalExtend = (workspaceGlobalExtend: ICommonStore['currentWorkspaceGlobalExtend']) => {
  return useWorkspaceStore.setState({ currentWorkspaceGlobalExtend: workspaceGlobalExtend });
}

export const requestPreloadTreeTables = (
  target: Omit<NonNullable<ICommonStore['preloadTreeTablesTarget']>, 'requestId'>,
) => {
  return useWorkspaceStore.setState({
    preloadTreeTablesTarget: {
      ...target,
      requestId: Date.now(),
    },
  });
}
