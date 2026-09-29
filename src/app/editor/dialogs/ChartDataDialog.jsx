// Chart data grid (spec §13.7): edit categories, series and values; paste
// CSV or TSV to fill cells.
import { useState } from 'preact/hooks';
import { Dialog, Button, IconButton } from '../../ui/components.jsx';
import { chartToGrid, gridToChart } from '../../../core/charts.js';
import { parseDelimited } from '../../../core/tables.js';
import { LIMITS } from '../../../core/limits.js';
import * as ops from '../../../core/ops.js';

export function ChartDataDialog({ close, ctl, elementId }) {
  const el = ctl.find(elementId)?.el;
  const [rows, setRows] = useState(() => (el ? chartToGrid(el.chart) : [['']]));
  const [error, setError] = useState('');
  if (!el) return null;
  const scatter = el.chart.kind === 'scatter';
  const pie = el.chart.kind === 'pie' || el.chart.kind === 'donut';
  const cols = Math.max(...rows.map((r) => r.length));

  const setCell = (r, c, v) => {
    setRows((old) => {
      const next = old.map((row) => row.slice());
      while (next[r].length <= c) next[r].push('');
      next[r][c] = v;
      return next;
    });
    setError('');
  };
  const addRow = () => setRows((old) => [...old, Array(cols).fill('')]);
  const addCol = () => setRows((old) => old.map((r, i) => [...r, i === 0 ? `Series ${cols}` : '']));
  const removeRow = (i) => setRows((old) => old.filter((_, j) => j !== i));
  const removeCol = (c) => setRows((old) => old.map((r) => r.filter((_, j) => j !== c)));

  const onPaste = (e, r0, c0) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!/[\t\n,]/.test(text)) return;
    e.preventDefault();
    const grid = parseDelimited(text);
    setRows((old) => {
      const next = old.map((row) => row.slice());
      grid.forEach((gr, i) => {
        const r = r0 + i;
        while (next.length <= r) next.push(Array(cols).fill(''));
        gr.forEach((v, j) => {
          const c = c0 + j;
          while (next[r].length <= c) next[r].push('');
          next[r][c] = v;
        });
      });
      return next.slice(0, LIMITS.chartPoints + 1);
    });
  };

  const apply = () => {
    const res = gridToChart(el.chart, rows);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    ctl.dispatch('Edit chart data', (d) => ops.updateElements(d, ctl.container, [elementId], (x) => { x.chart = res.chart; }));
    close(true);
  };

  const onKeyDown = (e, r, c) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = e.currentTarget.closest('table').querySelector(`[data-cell="${r + 1}:${c}"]`);
      if (next) next.focus();
      else {
        addRow();
        setTimeout(() => e.target.closest('table')?.querySelector(`[data-cell="${r + 1}:${c}"]`)?.focus(), 0);
      }
    }
  };

  return (
    <Dialog
      title="Chart data"
      onClose={() => close(false)}
      width={760}
      class="is-wide"
      description={scatter ? 'Each row is one point: series name, X and Y.' : pie ? 'First column: labels. Second column: values (one series).' : 'First column: categories. Other columns: one series each. Paste from a spreadsheet to fill cells.'}
      footer={
        <>
          {error && <span class="field-hint is-error grow" role="alert">{error}</span>}
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant="primary" onClick={apply} data-testid="chart-data-apply">Apply</Button>
        </>
      }
    >
      <div class="stack">
        <div class="data-grid-wrap">
          <table class="data-grid" aria-label="Chart data">
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c}>
                      <input
                        data-cell={`${r}:${c}`}
                        value={row[c] ?? ''}
                        aria-label={r === 0 ? (c === 0 ? 'Corner' : `Series ${c} name`) : c === 0 ? `Row ${r} label` : `Row ${r}, column ${c}`}
                        onInput={(e) => setCell(r, c, e.currentTarget.value)}
                        onPaste={(e) => onPaste(e, r, c)}
                        onKeyDown={(e) => onKeyDown(e, r, c)}
                        maxLength={100}
                      />
                    </td>
                  ))}
                  <td class="data-grid-tools">
                    {r > 0 && <IconButton icon="minus" class="is-small" label={`Remove row ${r}`} onClick={() => removeRow(r)} />}
                  </td>
                </tr>
              ))}
              {!scatter && !pie && (
                <tr>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c} class="data-grid-tools">{c > 1 && <IconButton icon="minus" class="is-small" label={`Remove column ${c}`} onClick={() => removeCol(c)} />}</td>
                  ))}
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div class="row">
          <Button icon="plus" class="btn-sm" onClick={addRow}>{scatter ? 'Add point' : 'Add row'}</Button>
          {!scatter && !pie && <Button icon="plus" class="btn-sm" onClick={addCol}>Add series</Button>}
        </div>
      </div>
    </Dialog>
  );
}
