import {useState, useEffect, useRef} from 'react';
import { ConsoleStatus } from '@/constants';
import { message } from 'antd';
import indexedDB from '@/indexedDB';
import historyServer from '@/service/history';
import i18n from '@/i18n';
import { getCookie } from '@/utils';
import { getSavedConsoleList } from '@/pages/main/workspace/store/console';


interface IProps {
  isActive?: boolean;
  source?: string;
  editorRef: any;
  boundInfo: any;
  defaultValue?: string;
  selectedTables?: string[];
}

export const useSaveEditorData = (props: IProps) => {
  const { isActive, source, editorRef, boundInfo, defaultValue, selectedTables = [] } = props;
  const timerRef = useRef<any>();
    // 上一次同步的console数据
  const lastSyncConsole = useRef<any>(defaultValue);
  const selectedTablesRef = useRef<string[]>(selectedTables);
  const invalidSavedConsoleIdRef = useRef<number | string | null>(null);
  const [saveStatus, setSaveStatus] = useState<ConsoleStatus>(boundInfo.status || ConsoleStatus.DRAFT);

  useEffect(() => {
    selectedTablesRef.current = selectedTables;
  }, [selectedTables]);

  const saveConsole = (value?: string, noPrompting?: boolean) => {
    if (!boundInfo.consoleId || invalidSavedConsoleIdRef.current === boundInfo.consoleId) {
      if (!noPrompting) {
        message.error('当前查询记录不存在，请重新新建查询后保存');
      }
      return;
    }

    const p: any = {
      id: boundInfo.consoleId,
      status: ConsoleStatus.RELEASE,
      ddl: value,
      selectedTables: JSON.stringify(selectedTablesRef.current),
    };

    historyServer.updateSavedConsoleSilently(p).then(() => {
      getSavedConsoleList();
      indexedDB.deleteData('chat2db', 'workspaceConsoleDDL', boundInfo.consoleId!);
      lastSyncConsole.current = value;
      setSaveStatus(ConsoleStatus.RELEASE);
      if (noPrompting) {
        return;
      }
      message.success(i18n('common.tips.saveSuccessfully'));
      timingAutoSave(ConsoleStatus.RELEASE);
    }).catch((error) => {
      if (String(error).includes('common.dataNotFound')) {
        invalidSavedConsoleIdRef.current = boundInfo.consoleId;
        if (!noPrompting) {
          message.error('当前查询记录不存在，请重新新建查询后保存');
        }
      } else if (!noPrompting) {
        message.error(i18n('common.notification.error'));
      }
    });
  };

  function timingAutoSave(_status?: ConsoleStatus) {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    timerRef.current = setInterval(() => {
      const curValue = editorRef?.current?.getAllContent();
      if (curValue === lastSyncConsole.current) {
        return;
      }
      if (saveStatus === ConsoleStatus.RELEASE || _status === ConsoleStatus.RELEASE) {
        saveConsole(curValue, true);
      } else {
        indexedDB
          .updateData('chat2db', 'workspaceConsoleDDL', {
            consoleId: boundInfo.consoleId!,
            ddl: curValue,
            userId: getCookie('CHAT2DB.USER_ID'),
          })
          .then(() => {
            lastSyncConsole.current = curValue;
          });
      }
    }, 5000);
  }

  useEffect(() => {
    if (source !== 'workspace') {
      return;
    }
    // 离开时保存
    if (!isActive) {
      // 离开时清除定时器
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      const curValue = editorRef?.current?.getAllContent();
      if (curValue === lastSyncConsole.current) {
        return;
      }
      if (saveStatus === ConsoleStatus.RELEASE) {
        saveConsole(curValue, true);
      } else {
        indexedDB
          .updateData('chat2db', 'workspaceConsoleDDL', {
            consoleId: boundInfo.consoleId!,
            ddl: curValue,
            userId: getCookie('CHAT2DB.USER_ID'),
          })
          .then(() => {
            lastSyncConsole.current = curValue;
          });
      }
    } else {
      timingAutoSave();
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isActive]);

  useEffect(() => {
    if (saveStatus === ConsoleStatus.RELEASE) {
      editorRef?.current?.setValue(defaultValue, 'cover');
    } else {
      indexedDB
        .getDataByCursor('chat2db', 'workspaceConsoleDDL', {
          consoleId: boundInfo.consoleId!,
          userId: getCookie('CHAT2DB.USER_ID'),
        })
        .then((res: any) => {
          // oldValue是为了处理函数视图等，他们是带着值来的，不需要去数据库取值
          const oldValue = editorRef?.current?.getAllContent();
          if (!oldValue) {
            editorRef?.current?.setValue(res?.[0]?.ddl || '', 'cover');
          }
        });
    }
  }, []);

  return {saveConsole, saveStatus}
}
