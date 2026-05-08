import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import sqlService from '@/service/sql';
import i18n from '@/i18n';

const fieldList: Record<string, Array<{ name: string; tableName: string }>> = {};
const fieldRequestMap: Record<string, Promise<Array<{ name: string; tableName: string }>>> = {};
let activeFieldCacheKeys = new Set<string>();

const getFieldCacheKey = (props: {
  tableName: string;
  dataSourceId?: number;
  databaseName?: string | null;
  schemaName?: string | null;
}) => {
  const { tableName, dataSourceId, databaseName, schemaName } = props;
  return [dataSourceId || '', databaseName || '', schemaName || '', tableName].join('|');
};

const loadFieldList = async (props: {
  tableName: string;
  dataSourceId?: number;
  databaseName?: string | null;
  schemaName?: string | null;
}) => {
  const { tableName, dataSourceId, databaseName, schemaName } = props;
  const cacheKey = getFieldCacheKey(props);

  if (fieldList[cacheKey]) {
    return fieldList[cacheKey];
  }

  if (!fieldRequestMap[cacheKey]) {
    fieldRequestMap[cacheKey] = sqlService.getAllFieldByTable({
      dataSourceId,
      databaseName,
      schemaName,
      tableName,
    });
  }

  try {
    fieldList[cacheKey] = await fieldRequestMap[cacheKey];
    return fieldList[cacheKey];
  } finally {
    delete fieldRequestMap[cacheKey];
  }
};

/** 当前库下的表 */
let intelliSenseField = monaco.languages.registerCompletionItemProvider('sql', {
  provideCompletionItems: () => {
    return {
      suggestions: [],
    };
  },
});

export const resetSenseField = () => {
  intelliSenseField.dispose();
}

const addIntelliSenseField = async (props: {
  tableName: string;
  dataSourceId?: number;
  databaseName?: string | null;
  schemaName?: string | null;
}) => {
  activeFieldCacheKeys.add(getFieldCacheKey(props));
  await loadFieldList(props);
};

function checkFieldContext(text) {
  const normalizedText = text.trim().toUpperCase();
  const columnKeywords = ['SELECT', 'WHERE', 'AND', 'OR', 'GROUP BY', 'ORDER BY', 'SET'];

  for (const keyword of columnKeywords) {
    if (normalizedText.endsWith(keyword)) {
      return true;
    }
  }

  return false;
}

const registerIntelliSenseField = (tableList: string[], dataSourceId, databaseName, schemaName) => {
  resetSenseField();
  activeFieldCacheKeys = new Set();
  intelliSenseField = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [' ', ',', '.', '('],
    provideCompletionItems: async (model, position) => {
      // 获取到当前行文本
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const isFieldContext = checkFieldContext(textUntilPosition);
      const match = textUntilPosition.match(/(\b\w+\b)[^\w]*$/);

      let word;
      if (match) {
        word = match[1];
      }

      if (!word) {
        return; // 如果没有匹配到，直接返回
      }
      if (word && tableList.includes(word)) {
        const fieldParams = {
          dataSourceId,
          databaseName,
          schemaName,
          tableName: word,
        };
        activeFieldCacheKeys.add(getFieldCacheKey(fieldParams));
        await loadFieldList(fieldParams);
      }

      const suggestions: monaco.languages.CompletionItem[] = Array.from(activeFieldCacheKeys).reduce((acc, cur) => {
        const arr = (fieldList[cur] || []).map((fieldObj) => ({
          label: {
            label: fieldObj.name,
            detail: `(${fieldObj.tableName})`,
            description: i18n('sqlEditor.text.fieldName'),
          },
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: fieldObj.name,
          sortText: isFieldContext ? '01' : '08',
        }));

        return [...acc, ...arr];
      }, []);

      return {
        suggestions,
      };
    },
  });
};

export { intelliSenseField, registerIntelliSenseField, addIntelliSenseField };
