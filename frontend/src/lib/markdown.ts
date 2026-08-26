function normalizeTableRow(line: string): string {
  const inner = line.replace(/^\|/, '').replace(/\|$/, '');
  return '| ' + inner.split('|').map(s => s.trim()).join(' | ') + ' |';
}

function isSeparatorLine(cells: string[]): boolean {
  return cells.length > 0 && cells.every(c => /^[-:\s]+$/.test(c.trim()));
}

function tabLineToPipe(line: string): string {
  const cells = line.split('\t');
  return '| ' + cells.map(c => c.trim()).join(' | ') + ' |';
}

/**
 * Convert tab-separated table blocks to pipe-separated markdown tables.
 * The LLM often generates tab-separated tables instead of pipe-separated ones.
 */
function convertTabTablesToPipe(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.includes('\t')) {
      const blockLines: string[] = [];
      while (i < lines.length && lines[i].includes('\t')) {
        blockLines.push(lines[i]);
        i++;
      }

      if (blockLines.length === 0) continue;

      let sepIndex = -1;
      for (let j = 0; j < blockLines.length; j++) {
        if (isSeparatorLine(blockLines[j].split('\t'))) {
          sepIndex = j;
          break;
        }
      }

      if (sepIndex === -1) {
        const headerLine = blockLines[0];
        const headerCells = headerLine.split('\t');
        const colCount = headerCells.length;

        result.push('| ' + headerCells.map(c => c.trim()).join(' | ') + ' |');
        result.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');

        for (let j = 1; j < blockLines.length; j++) {
          result.push(tabLineToPipe(blockLines[j]));
        }
      } else {
        const headerLines = blockLines.slice(0, sepIndex);
        const sepLine = blockLines[sepIndex];
        const bodyLines = blockLines.slice(sepIndex + 1);

        const sepCells = sepLine.split('\t');
        const colCount = sepCells.length;

        const allHeaderCells: string[] = [];
        for (const hl of headerLines) {
          allHeaderCells.push(...hl.split('\t').map(c => c.trim()));
        }

        let prefixLine = '';
        if (allHeaderCells.length > 0 && /[：:]/.test(allHeaderCells[0])) {
          const m = allHeaderCells[0].match(/^(.+?[：:])/);
          if (m) {
            prefixLine = m[1];
            const rest = allHeaderCells[0].slice(m[1].length).trim();
            if (rest) {
              allHeaderCells[0] = rest;
            } else {
              allHeaderCells.shift();
            }
          }
        }

        while (allHeaderCells.length < colCount) allHeaderCells.push('');
        const finalHeader = allHeaderCells.slice(0, colCount);

        if (prefixLine) result.push(prefixLine);
        result.push('| ' + finalHeader.join(' | ') + ' |');
        result.push('| ' + sepCells.map(c => c.trim()).join(' | ') + ' |');

        const allBodyCells: string[] = [];
        for (const bl of bodyLines) {
          allBodyCells.push(...bl.split('\t').map(c => c.trim()));
        }

        const needReflow = bodyLines.length > 0
          && bodyLines.every(bl => bl.split('\t').length < colCount)
          && allBodyCells.length % colCount === 0;

        if (needReflow) {
          for (let j = 0; j < allBodyCells.length; j += colCount) {
            const row = allBodyCells.slice(j, j + colCount);
            result.push('| ' + row.join(' | ') + ' |');
          }
        } else {
          for (const bl of bodyLines) {
            const cells = bl.split('\t');
            while (cells.length < colCount) cells.push('');
            result.push('| ' + cells.slice(0, colCount).map(c => c.trim()).join(' | ') + ' |');
          }
        }
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Fix LLM-generated markdown tables that are malformed:
 * - Tab-separated tables (convert to pipe-separated)
 * - Header and separator on same line (no newline)
 * - Missing pipes
 * - Extra pipes (||)
 * - Headers interleaved with body cells
 */
export function fixMarkdownTable(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, idx) => {
    if (idx % 2 === 1) return part;

    let result = convertTabTablesToPipe(part);

    result = result.replace(/([^\n])(#{2,3}\s)/g, '$1\n\n$2');
    result = result.replace(/(#{2,3}\s[^#|\n]+?)(\|)/g, '$1\n$2');
    result = result.replace(/(#{2,3}\s[^\n]+?)(\*\*[^*]+\*\*)/g, '$1\n$2');
    result = result.replace(
      /\|(?:[^|\n]*\|)+/g,
      (match) => {
        const cells = match.split('|').filter(s => s.trim() !== '');
        const sepStart = cells.findIndex(c => /^[-:\s]+$/.test(c.trim()));
        if (sepStart === -1) {
          return normalizeTableRow(match);
        }

        const headerCells = cells.slice(0, sepStart);
        const colCount = headerCells.length;
        if (colCount === 0) return match;

        let sepEnd = sepStart;
        while (sepEnd < cells.length && /^[-:\s]+$/.test(cells[sepEnd].trim())) {
          sepEnd++;
        }
        const sepCells = cells.slice(sepStart, sepEnd);
        const bodyCells = cells.slice(sepEnd);

        const rows: string[] = [];
        for (let i = 0; i < bodyCells.length; i += colCount) {
          const row = bodyCells.slice(i, i + colCount).map(c => c.trim()).join(' | ');
          if (row) rows.push('| ' + row + ' |');
        }

        return '\n\n| ' + headerCells.map(c => c.trim()).join(' | ') + ' |\n| ' + sepCells.map(c => c.trim()).join(' | ') + ' |\n' + rows.join('\n') + '\n\n';
      }
    );
    result = result.replace(/^\|.+\|$/gm, (line) => {
      const inner = line.replace(/^\|/, '').replace(/\|$/, '');
      return '| ' + inner.split('|').map(s => s.trim()).join(' | ') + ' |';
    });

    result = result.replace(/(\|.+\|)\n(\|.+\|)\n(\|[-:| ]+\|)/g, '$1\n\n$2\n$3');
    result = result.replace(/([^\n|])\n(\|[^\n]+\|)\n(\|[-:| ]+\|)/g, '$1\n\n$2\n$3');

    return result;
  }).join('');
}