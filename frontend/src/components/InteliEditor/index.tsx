import Editor from '@monaco-editor/react';
import type { CodePageData } from '@/types/page';

type FileType = 'html' | 'css' | 'js';

const FILE_LANG: Record<FileType, string> = {
  html: 'html',
  css: 'css',
  js: 'javascript',
};

interface InteliEditorProps {
  codePage: CodePageData;
  activeFile: FileType;
  onCodeChange: (type: FileType, value: string) => void;
}

export function InteliEditor({ codePage, activeFile, onCodeChange }: InteliEditorProps) {
  const getValue = () => {
    switch (activeFile) {
      case 'html': return codePage.html || '';
      case 'css': return codePage.css || '';
      case 'js': return codePage.js || '';
    }
  };

  return (
    <Editor
      height="100%"
      language={FILE_LANG[activeFile]}
      value={getValue()}
      onChange={(value) => onCodeChange(activeFile, value || '')}
      theme="vs"
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        tabSize: 2,
        automaticLayout: true,
      }}
    />
  );
}