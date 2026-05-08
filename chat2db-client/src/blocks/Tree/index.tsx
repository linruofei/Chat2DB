import React, { memo, useEffect, useMemo, useState, createContext, useContext, useRef } from 'react';
import styles from './index.less';
import classnames from 'classnames';
import Iconfont from '@/components/Iconfont';
import { Tooltip, Dropdown } from 'antd';
import { ITreeNode } from '@/typings';
import { TreeNodeType, databaseMap } from '@/constants';
import { treeConfig, switchIcon, ITreeConfigItem } from './treeConfig';
import { useCommonStore } from '@/store/common';
import { requestPreloadTreeTables, setCurrentWorkspaceGlobalExtend } from '@/pages/main/workspace/store/common';
import { useWorkspaceStore } from '@/pages/main/workspace/store';
import LoadingGracile from '@/components/Loading/LoadingGracile';
import { setFocusId, setFocusTreeNode, useTreeStore, clearTreeStore } from './treeStore';
import { useGetRightClickMenu } from './hooks/useGetRightClickMenu';
import MenuLabel from '@/components/MenuLabel';
import LoadingContent from '@/components/Loading/LoadingContent';
import { cloneDeep } from 'lodash';
// import { flushSync } from 'react-dom';

interface IProps {
  className?: string;
  treeData: ITreeNode[] | null;
  searchValue: string;
}

interface TreeNodeIProps {
  data: ITreeNode;
  level: number;
}

interface IContext {
  treeData: ITreeNode[];
  setTreeData: (value: ITreeNode[] | null) => void;
  searchTreeData: ITreeNode[] | null;
  setSearchTreeData: (value: ITreeNode[] | null) => void;
}

export const Context = createContext<IContext>({} as any);

// 树转平级
const smoothTree = (treeData: ITreeNode[], result: ITreeNode[] = [], parentNode?: ITreeNode) => {
  treeData.forEach((item) => {
    if (parentNode) {
      item.parentNode = parentNode;
      item.level = (parentNode.level || 0) + 1;
    }
    result.push(item);
    if (item.children) {
      smoothTree(item.children, result, item);
    }
  });
  return result;
};

// 平级转树
function tranListToTreeData(list:ITreeNode[], rootValue) {
  const arr:ITreeNode[] = []
  list.forEach((item:ITreeNode) => {
    if (item.parentNode?.uuid === rootValue) {
      arr.push(item)
      const children = tranListToTreeData(list, item.uuid)
      if (children.length) {
        item.children = children
      }
    }
  })
  return arr
}

// 判断是否匹配
const isMatch = (target: string, searchValue: string) => {
  const reg = new RegExp(searchValue, 'i');
  return reg.test(target || '');
};

// 树结构搜索
function searchTree(treeData: ITreeNode[], searchValue: string): ITreeNode[] {
  let result: ITreeNode[] = [];

  // 深度优先遍历
  function dfs(node: ITreeNode, path: ITreeNode[] = []) {
    if (isMatch(node.name, searchValue)) {
      result = [...result, ...path, node];
      return;
    }
    if (!node.children) return;
    node.children.forEach((child) => {
      dfs(child, [...path, node]);
    });
  }

  // 遍历树
  treeData.forEach((node) => dfs(node));

  // 根据uuid去重
  const deWeightList: ITreeNode[] = [];
  result.forEach((item) => {
    // 如果不匹配，说明该节点为path，不需要保留该节点的子元素，就把children置空
    if (!isMatch(item.name, searchValue)) {
      item.children = null;
    }
    deWeightList.findIndex((i) => i.uuid === item.uuid) === -1 && deWeightList.push(item);
  });

  return tranListToTreeData(deWeightList, undefined);
}

const itemHeight = 26; // 每个 item 的高度
const paddingCount = 2;

const findTreeNode = (
  treeData: ITreeNode[] | null | undefined,
  predicate: (node: ITreeNode) => boolean,
): ITreeNode | null => {
  if (!treeData) {
    return null;
  }
  for (let i = 0; i < treeData.length; i++) {
    if (predicate(treeData[i])) {
      return treeData[i];
    }
    const childResult = findTreeNode(treeData[i].children, predicate);
    if (childResult) {
      return childResult;
    }
  }
  return null;
};

const findTreeNodes = (
  treeData: ITreeNode[] | null | undefined,
  predicate: (node: ITreeNode) => boolean,
  result: ITreeNode[] = [],
): ITreeNode[] => {
  if (!treeData) {
    return result;
  }
  treeData.forEach((item) => {
    if (predicate(item)) {
      result.push(item);
    }
    findTreeNodes(item.children, predicate, result);
  });
  return result;
};

const insertTreeData = (_treeData: ITreeNode[], uuid: string, data: ITreeNode[] | null): ITreeNode | null => {
  let result: ITreeNode | null = null;
  for (let i = 0; i < _treeData?.length; i++) {
    if (_treeData[i].uuid === uuid) {
      result = _treeData[i];
      if (data) {
        data.forEach((item: ITreeNode) => {
          item.parentNode = result!;
        });
        result.children = [...(result.children || []), ...(data || [])];
      } else {
        result.children = null;
      }
      break;
    } else if (_treeData[i].children) {
      result = insertTreeData(_treeData[i].children!, uuid, data);
      if (result) {
        break;
      }
    }
  }
  return result;
};

const Tree = (props: IProps) => {
  const { className, treeData: outerTreeData, searchValue } = props;
  const preloadTreeTablesTarget = useWorkspaceStore((state) => state.preloadTreeTablesTarget);
  const handledPreloadRequestIdRef = useRef<number | null>(null);
  const processingPreloadRequestIdRef = useRef<number | null>(null);
  const [treeData, setTreeData] = useState<ITreeNode[] | null>(null);
  const [smoothTreeData, setSmoothTreeData] = useState<ITreeNode[]>([]);
  const [searchTreeData, setSearchTreeData] = useState<ITreeNode[] | null>(null); // 搜索结果
  const [searchSmoothTreeData, setSearchSmoothTreeData] = useState<ITreeNode[] | null>(null); // 搜索结果 平级

  const [scrollTop, setScrollTop] = useState(0); // 滚动位置 // 继续需要渲染的 item 索引有哪些

  const startIdx = useMemo(() => {
    let _startIdx = Math.floor(scrollTop / itemHeight);
    _startIdx = Math.max(_startIdx - paddingCount, 0); // 处理越界情况
    return _startIdx;
  }, [scrollTop]);

  const top = itemHeight * startIdx; // 第一个渲染的 item 到顶部距离

  // 清空treeStore
  useEffect(() => {
    return () => {
      clearTreeStore();
    }
  }, [searchValue]);

  useEffect(() => {
    setTreeData(outerTreeData);
    setScrollTop(0);
  }, [outerTreeData]);

  useEffect(() => {
    if (treeData) {
      const result: ITreeNode[] = [];
      smoothTree(treeData, result);
      setSmoothTreeData(result);
    } else {
      setSmoothTreeData([]);
    }
  }, [treeData]);

  // 搜索结果转平级
  useEffect(() => {
    if (searchTreeData) {
      const result: ITreeNode[] = [];
      smoothTree(searchTreeData, result);
      setSearchSmoothTreeData(result);
    } else {
      setSearchSmoothTreeData(null);
    }
  }, [searchTreeData]);

  const treeNodes = useMemo(() => {
    const realNodeList = (searchSmoothTreeData || smoothTreeData).slice(startIdx, startIdx + 50);
    return realNodeList.map((item) => {
      return <TreeNode key={item.uuid} level={item.level || 0} data={item} />;
    });
  }, [smoothTreeData, searchSmoothTreeData, startIdx]);

  useEffect(() => {
    if (searchValue && treeData) {
      const _searchTreeData = searchTree(cloneDeep(treeData), searchValue);
      setSearchTreeData(_searchTreeData);
      setScrollTop(0);
    } else {
      setSearchTreeData(null);
    }
  }, [searchValue]);

  const loadNodeChildren = async (_treeData: ITreeNode[], node: ITreeNode) => {
    if (node.children?.length) {
      return node.children;
    }
    const treeNodeConfig: ITreeConfigItem = treeConfig[node.pretendNodeType || node.treeNodeType];
    if (!treeNodeConfig?.getChildren) {
      return node.children || [];
    }

    insertTreeData(_treeData, node.uuid!, null);

    const loadPage = async (pageNo: number, result: ITreeNode[] = []): Promise<ITreeNode[]> => {
      const res: any = await treeNodeConfig.getChildren?.({
        ...node.extraParams,
        extraParams: {
          ...node.extraParams,
        },
        refresh: false,
        pageNo,
      });
      if (res?.data) {
        const nextResult = [...result, ...(res.data || [])];
        if (res.hasNextPage) {
          return loadPage(res.pageNo + 1, nextResult);
        }
        return nextResult;
      }
      return Array.isArray(res) ? res : result;
    };

    const children = await loadPage(1);
    insertTreeData(_treeData, node.uuid!, children);
    setTreeData(cloneDeep(_treeData));
    return node.children || [];
  };

  const preloadTablesForTarget = async () => {
    if (!treeData || !preloadTreeTablesTarget) {
      return false;
    }

    const target = preloadTreeTablesTarget;
    const databaseNode = target.databaseName
      ? findTreeNode(
          treeData,
          (node) =>
            node.treeNodeType === TreeNodeType.DATABASE &&
            node.extraParams?.dataSourceId === target.dataSourceId &&
            node.name === target.databaseName,
        )
      : null;

    if (databaseNode) {
      await loadNodeChildren(treeData, databaseNode);
    }

    const schemaSource = databaseNode?.children || treeData;
    const schemaNodes = findTreeNodes(
      schemaSource,
      (node) =>
        node.treeNodeType === TreeNodeType.SCHEMAS &&
        node.extraParams?.dataSourceId === target.dataSourceId &&
        (!target.databaseName || !node.extraParams?.databaseName || node.extraParams?.databaseName === target.databaseName) &&
        (!target.schemaName || node.extraParams?.schemaName === target.schemaName || node.name === target.schemaName),
    );

    if (!schemaNodes.length) {
      return false;
    }

    for (const schemaNode of schemaNodes) {
      await loadNodeChildren(treeData, schemaNode);
      const tablesNode = schemaNode.children?.find((item) => item.treeNodeType === TreeNodeType.TABLES);
      if (tablesNode) {
        await loadNodeChildren(treeData, tablesNode);
      }
    }
    setTreeData(cloneDeep(treeData));
    return true;
  };

  useEffect(() => {
    if (
      !preloadTreeTablesTarget ||
      handledPreloadRequestIdRef.current === preloadTreeTablesTarget.requestId ||
      processingPreloadRequestIdRef.current === preloadTreeTablesTarget.requestId ||
      !treeData
    ) {
      return;
    }
    processingPreloadRequestIdRef.current = preloadTreeTablesTarget.requestId;
    preloadTablesForTarget()
      .then((handled) => {
        if (handled) {
          handledPreloadRequestIdRef.current = preloadTreeTablesTarget.requestId;
        }
      })
      .finally(() => {
        if (processingPreloadRequestIdRef.current === preloadTreeTablesTarget.requestId) {
          processingPreloadRequestIdRef.current = null;
        }
      });
  }, [preloadTreeTablesTarget, treeData]);

  return (
    <LoadingContent isLoading={!treeData} className={classnames(className)}>
      <Context.Provider
        value={{
          treeData: treeData!,
          setTreeData: setTreeData!,
          searchTreeData, 
          setSearchTreeData
        }}
      >
        <div
          className={classnames(styles.scrollBox)}
          onScroll={(e: any) => {
            setScrollTop(e.target.scrollTop);
          }}
        >
          <div
            className={styles.treeListHolder}
            style={{ '--tree-node-count': (searchSmoothTreeData || smoothTreeData)?.length } as any}
          >
            <div style={{ height: top }} />
            {treeNodes}
          </div>
        </div>
      </Context.Provider>
    </LoadingContent>
  );
};

const TreeNode = memo((props: TreeNodeIProps) => {
  const { data: treeNodeData, level } = props;
  const [isLoading, setIsLoading] = useState(false);
  const indentArr = new Array(level).fill('indent');
  const { treeData, setTreeData, searchTreeData, setSearchTreeData } = useContext(Context);

  // 加载数据
  function loadData(_props?: { refresh: boolean; pageNo: number; treeNodeData?: ITreeNode }) {
    const _treeNodeData = _props?.treeNodeData || props.data;
    const treeNodeConfig: ITreeConfigItem = treeConfig[_treeNodeData.pretendNodeType || _treeNodeData.treeNodeType];
    setIsLoading(true);
    if (_props?.pageNo === 1 || !_props?.pageNo) {
      insertData(treeData!, _treeNodeData.uuid!, null,[treeData, setTreeData]);
      if(searchTreeData){
        insertData(searchTreeData!, _treeNodeData.uuid!, null,[searchTreeData, setSearchTreeData]);
      }
    }

    treeNodeConfig
      .getChildren?.({
        ..._treeNodeData.extraParams,
        extraParams: {
          ..._treeNodeData.extraParams,
        },
        refresh: _props?.refresh || false,
        pageNo: _props?.pageNo || 1,
      })
      .then((res: any) => {
        if (res.length || res.data) {
          if (res.data) {
            insertData(treeData!, _treeNodeData.uuid!, res.data, [treeData, setTreeData]);
            if(searchTreeData){
              insertData(searchTreeData!, _treeNodeData.uuid!, res.data,[searchTreeData, setSearchTreeData]);
            }
            if (res.hasNextPage) {
              loadData({
                refresh: _props?.refresh || false,
                pageNo: res.pageNo + 1,
              });
            }
          } else {
            insertData(treeData!, _treeNodeData.uuid!, res,[treeData, setTreeData]);
            if(searchTreeData){
              insertData(searchTreeData!, _treeNodeData.uuid!, res,[searchTreeData, setSearchTreeData]);
            }
          }
          setIsLoading(false);
        } else {
          // 处理树可能出现不连续的情况
          if (treeNodeConfig.next) {
            _treeNodeData.pretendNodeType = treeNodeConfig.next;
            loadData();
          } else {
            insertData(treeData!, _treeNodeData.uuid!, [],[treeData, setTreeData]);
            if(searchTreeData){
              insertData(searchTreeData!, _treeNodeData.uuid!, [],[searchTreeData, setSearchTreeData]);
            }
            setIsLoading(false);
          }
        }
      })
      .catch(() => {
        setIsLoading(false);
      });
  }

  // 当前节点是否是focus
  const isFocus = useTreeStore((state) => state.focusId) === treeNodeData.uuid;

  //  在treeData中找到对应的节点，插入数据
  const insertData = (_treeData: ITreeNode[], uuid: string, data: any, originalDataList:any): ITreeNode | null => {
    const [originalData,setOriginalData] = originalDataList
    let result: ITreeNode | null = null;
    for (let i = 0; i < _treeData?.length; i++) {
      if (_treeData[i].uuid === uuid) {
        result = _treeData[i];
        if (data) {
          data.map((item: any) => {
            item.parentNode = result;
          });
          result.children = [...(result.children || []), ...(data || [])];
        } else {
          result.children = null;
        }
        setOriginalData?.(cloneDeep([...(originalData || [])]));
        break;
      } else {
        if (_treeData[i].children) {
          result = insertData(_treeData[i].children!, uuid, data, originalDataList);
          if (result) {
            break;
          }
        }
      }
    }
    return result;
  };

  //展开-收起
  const handleClick = () => {
    if (treeNodeData?.children) {
      insertData(treeData!, treeNodeData.uuid!, null,[treeData, setTreeData]);
      if(searchTreeData){
        insertData(searchTreeData!, treeNodeData.uuid!, null,[searchTreeData, setSearchTreeData]);
      }
    } else {
      loadData();
    }
  };

  // 找到对应的icon
  const recognizeIcon = (treeNodeType: TreeNodeType) => {
    if (treeNodeType === TreeNodeType.DATA_SOURCE) {
      return databaseMap[treeNodeData.extraParams!.databaseType!]?.icon;
    } else {
      return (
        switchIcon[treeNodeType]?.[treeNodeData.children ? 'unfoldIcon' : 'icon'] || switchIcon[treeNodeType]?.icon
      );
    }
  };

  // 点击节点
  const handelClickTreeNode = () => {
    useCommonStore.setState({
      focusedContent: (treeNodeData.name || '') as any,
    });
    if(treeNodeData.treeNodeType === TreeNodeType.TABLE){
      setCurrentWorkspaceGlobalExtend({
        code: 'viewDDL',
        uniqueData: {
          dataSourceId: treeNodeData.extraParams?.dataSourceId,
          dataSourceName: treeNodeData.extraParams?.dataSourceName,
          databaseName: treeNodeData.extraParams?.databaseName,
          databaseType: treeNodeData.extraParams?.databaseType,
          schemaName: treeNodeData.extraParams?.schemaName,
          tableName: treeNodeData.name,
        }
      });
    }
    setFocusId(treeNodeData.uuid || '');

    setFocusTreeNode({
      dataSourceId: treeNodeData.extraParams!.dataSourceId,
      dataSourceName: treeNodeData.extraParams!.dataSourceName,
      databaseType: treeNodeData.extraParams!.databaseType,
      databaseName: treeNodeData.extraParams?.databaseName,
      schemaName: treeNodeData.extraParams?.schemaName,
    });

    if (treeNodeData.treeNodeType === TreeNodeType.DATABASE || treeNodeData.treeNodeType === TreeNodeType.SCHEMAS) {
      requestPreloadTreeTables({
        dataSourceId: treeNodeData.extraParams!.dataSourceId,
        dataSourceName: treeNodeData.extraParams!.dataSourceName,
        databaseType: treeNodeData.extraParams!.databaseType,
        databaseName: treeNodeData.extraParams?.databaseName,
        schemaName: treeNodeData.treeNodeType === TreeNodeType.SCHEMAS ? treeNodeData.extraParams?.schemaName : undefined,
      });
    }
  };

  // 双击节点
  const handelDoubleClickTreeNode = () => {
    if (
      treeNodeData.treeNodeType === TreeNodeType.TABLE ||
      treeNodeData.treeNodeType === TreeNodeType.VIEW ||
      treeNodeData.treeNodeType === TreeNodeType.PROCEDURE ||
      treeNodeData.treeNodeType === TreeNodeType.FUNCTION ||
      treeNodeData.treeNodeType === TreeNodeType.SEQUENCE ||
      treeNodeData.treeNodeType === TreeNodeType.TRIGGER
    ) {
      rightClickMenu.find((item) => item.doubleClickTrigger)?.onClick(treeNodeData);
    } else {
      handleClick();
    }
  };

  const rightClickMenu = useGetRightClickMenu({
    treeNodeData,
    loadData,
  });

  const treeNodeDom = useMemo(() => {
    const dropdownsItems: any = rightClickMenu.map((item) => {
      return {
        key: item.key,
        onClick: () => {
          item.onClick(treeNodeData);
        },
        label: <MenuLabel icon={item.labelProps.icon} label={item.labelProps.label} />,
      };
    });
    return (
      <Dropdown
        trigger={['contextMenu']}
        menu={{
          items: dropdownsItems,
          style: dropdownsItems?.length ? {} : { display: 'none' }, // 有菜单项才显示
        }}
        overlayStyle={{
          zIndex: 1080,
        }}
      >
        <Tooltip placement="right" color={window._AppThemePack?.colorPrimary} title={treeNodeData.comment}>
          <div
            className={classnames(styles.treeNode, { [styles.treeNodeFocus]: isFocus })}
            onClick={handelClickTreeNode}
            onContextMenu={handelClickTreeNode}
            onDoubleClick={handelDoubleClickTreeNode}
            data-chat2db-general-can-copy-element
          >
            <div className={styles.left}>
              {indentArr.map((item, i) => {
                return <div key={i} className={styles.indent} />;
              })}
            </div>
            <div className={styles.right}>
              {!treeNodeData.isLeaf && (
                <div onClick={handleClick} className={classnames(styles.arrows, { [styles.loadingArrows]: isLoading })}>
                  {isLoading ? (
                    <LoadingGracile />
                  ) : (
                    <Iconfont
                      className={classnames(styles.arrowsIcon, {
                        [styles.rotateArrowsIcon]: treeNodeData.children,
                      })}
                      code="&#xe641;"
                    />
                  )}
                </div>
              )}
              <div className={styles.dblclickArea}>
                <div className={styles.typeIcon}>
                  <Iconfont code={recognizeIcon(treeNodeData.treeNodeType)!} />
                </div>
                <div className={styles.contentText}>
                  <div className={styles.name} dangerouslySetInnerHTML={{ __html: treeNodeData.name }} />
                  {treeNodeData.treeNodeType === TreeNodeType.COLUMN && (
                    <div className={styles.type}>
                      {/* 转小写 */}
                      {treeNodeData.columnType?.toLowerCase()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Tooltip>
      </Dropdown>
    );
  }, [isFocus, isLoading, rightClickMenu, treeNodeData.children]);

  return treeNodeDom;
});

export default memo(Tree);
