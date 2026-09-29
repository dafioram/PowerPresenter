// Context menus for the canvas and the slide list.
import { elementLabel, slideOrder } from '../../core/model.js';
import { geometryKind } from '../../core/geometry.js';
import * as ops from '../../core/ops.js';
import { shortcut } from '../settings.js';
import { menuCopy, menuPaste, openLink, copyFormat } from './commands.js';
import { openDialog, promptDialog, toast } from '../ui/components.jsx';
import { ChartDataDialog } from './dialogs/ChartDataDialog.jsx';
import { pickFiles } from '../download.js';
import { newId } from '../../core/ids.js';

export function replaceImage(ctl, el) {
  pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml' }).then((files) => {
    if (files?.[0]) ctl.fillSlot?.(el, files[0]);
  });
}

export function addCaptions(ctl, el) {
  pickFiles({ accept: '.vtt,text/vtt' }).then((files) => {
    if (!files?.[0]) return;
    ctl.select([el.id]);
    ctl.insertFiles([files[0]]);
  });
}

export function arrangeItems(ctl) {
  const sel = ctl.selectedElements();
  const n = sel.length;
  return [
    { label: 'Bring to front', icon: 'front', shortcut: shortcut('Mod+Shift+]'), disabled: !n, onSelect: () => ctl.reorder('front') },
    { label: 'Bring forward', shortcut: shortcut('Mod+]'), disabled: !n, onSelect: () => ctl.reorder('forward') },
    { label: 'Send backward', shortcut: shortcut('Mod+['), disabled: !n, onSelect: () => ctl.reorder('backward') },
    { label: 'Send to back', icon: 'back', shortcut: shortcut('Mod+Shift+['), disabled: !n, onSelect: () => ctl.reorder('back') },
    { separator: true },
    { label: 'Align left', icon: 'alignLeft', disabled: !n, onSelect: () => ctl.align('left') },
    { label: 'Align center', icon: 'alignCenter', disabled: !n, onSelect: () => ctl.align('center') },
    { label: 'Align right', icon: 'alignRight', disabled: !n, onSelect: () => ctl.align('right') },
    { label: 'Align top', disabled: !n, onSelect: () => ctl.align('top') },
    { label: 'Align middle', disabled: !n, onSelect: () => ctl.align('middle') },
    { label: 'Align bottom', disabled: !n, onSelect: () => ctl.align('bottom') },
    { separator: true },
    { label: 'Distribute horizontally', disabled: n < 3, onSelect: () => ctl.distribute('x') },
    { label: 'Distribute vertically', disabled: n < 3, onSelect: () => ctl.distribute('y') },
    { label: 'Match width', disabled: n < 2, onSelect: () => ctl.matchSize('width') },
    { label: 'Match height', disabled: n < 2, onSelect: () => ctl.matchSize('height') },
    { separator: true },
    { label: 'Flip horizontal', icon: 'flipH', disabled: !n || !sel.every(ops.canRotate), onSelect: () => ctl.flip('x') },
    { label: 'Flip vertical', icon: 'flipV', disabled: !n || !sel.every(ops.canRotate), onSelect: () => ctl.flip('y') },
    { separator: true },
    { label: 'Group', icon: 'group', shortcut: shortcut('Mod+G'), disabled: n < 2, onSelect: () => ctl.group() },
    { label: 'Ungroup', icon: 'ungroup', shortcut: shortcut('Mod+Shift+G'), disabled: !sel.some((e) => e.type === 'group'), onSelect: () => ctl.ungroup() },
  ];
}

export function contextMenuItems(ctl, { target, point }) {
  const ro = ctl.state.readOnly;
  const items = [];
  if (target?.locked) {
    items.push({ label: `Unlock “${elementLabel(target)}”`, icon: 'unlock', disabled: ro, onSelect: () => { ctl.setProps({ locked: undefined }, [target.id], 'Unlock'); ctl.select([target.id]); } });
    items.push({ separator: true });
  }
  const sel = ctl.selectedElements();
  const one = sel.length === 1 ? sel[0] : null;
  if (sel.length) {
    items.push(
      { label: 'Cut', shortcut: shortcut('Mod+X'), disabled: ro, onSelect: () => menuCopy(true) },
      { label: 'Copy', icon: 'copy', shortcut: shortcut('Mod+C'), onSelect: () => menuCopy(false) },
      { label: 'Paste', shortcut: shortcut('Mod+V'), disabled: ro, onSelect: () => menuPaste(ctl) },
      { label: 'Duplicate', shortcut: shortcut('Mod+D'), disabled: ro, onSelect: () => ctl.duplicateSelection() },
      { label: 'Delete', icon: 'trash', shortcut: 'Del', disabled: ro, danger: true, onSelect: () => ctl.deleteSelection() },
      { separator: true },
    );
    if (one && (one.type === 'text' || one.type === 'shape')) items.push({ label: 'Edit text', icon: 'text', shortcut: 'Enter', disabled: ro, onSelect: () => ctl.startEditing?.(one.id) });
    if (one?.type === 'group') items.push({ label: 'Select inside group', shortcut: 'Enter', onSelect: () => ctl.set({ enteredGroup: one.id, selection: [one.group.children[0].id] }) });
    if (one?.type === 'image') {
      items.push(
        { label: one.image.asset_id ? 'Replace image…' : 'Choose image…', icon: 'image', disabled: ro, onSelect: () => replaceImage(ctl, one) },
        { label: 'Crop', icon: 'crop', disabled: ro || !one.image.asset_id, onSelect: () => ctl.set({ crop: one.id }) },
      );
      if (one.image.crop) items.push({ label: 'Reset crop', disabled: ro, onSelect: () => ctl.setProps({ 'image.crop': undefined }, [one.id], 'Reset crop') });
    }
    if (one?.type === 'video') {
      items.push({ label: 'Add captions (.vtt)…', icon: 'captions', disabled: ro, onSelect: () => addCaptions(ctl, one) });
    }
    if (one?.type === 'chart') items.push({ label: 'Edit chart data…', icon: 'table', disabled: ro, onSelect: () => openDialog(ChartDataDialog, { ctl, elementId: one.id }) });
    if (sel.every((e) => e.type !== 'group' || true)) items.push({ label: 'Link…', icon: 'link', shortcut: shortcut('Mod+K'), disabled: ro, onSelect: () => openLink(ctl) });
    items.push({ label: 'Copy formatting', icon: 'paint', shortcut: shortcut('Mod+Alt+C'), disabled: !one, onSelect: () => copyFormat(ctl) });
    items.push({ separator: true });
    items.push(...arrangeItems(ctl).filter((i) => !i.separator && ['Bring to front', 'Bring forward', 'Send backward', 'Send to back', 'Group', 'Ungroup'].includes(i.label)));
    items.push({ separator: true });
    const allLocked = sel.every((e) => e.locked);
    items.push({ label: allLocked ? 'Unlock' : 'Lock', icon: allLocked ? 'unlock' : 'lock', disabled: ro, onSelect: () => ctl.setProps({ locked: allLocked ? undefined : true }, sel.map((e) => e.id), allLocked ? 'Unlock' : 'Lock') });
    items.push({ label: 'Hide', icon: 'eyeOff', disabled: ro, onSelect: () => { ctl.setProps({ hidden: true }, sel.map((e) => e.id), 'Hide'); ctl.select([]); } });
    if (ctl.state.mode === 'slide' && sel.length === 1 && ctl.slide?.elements.some((e) => e.id === one?.id)) {
      items.push({ separator: true }, { label: 'Add build (fade in)', icon: 'play', disabled: ro, onSelect: () => { ctl.addBuild(one.id, 'fade_in'); ctl.set({ panel: 'inspector', inspectorTab: 'builds' }); } });
    }
  } else {
    items.push(
      { label: 'Paste', shortcut: shortcut('Mod+V'), disabled: ro, onSelect: () => menuPaste(ctl) },
      { label: 'Select all', shortcut: shortcut('Mod+A'), onSelect: () => ctl.selectAll() },
      { separator: true },
    );
    if (ctl.state.mode === 'slide') {
      items.push(
        { label: 'New slide', icon: 'plus', shortcut: 'Ctrl+M', disabled: ro, onSelect: () => ctl.addSlide() },
        { label: 'Slide properties', icon: 'settings', onSelect: () => ctl.set({ panel: 'inspector', inspectorTab: 'format', selection: [] }) },
      );
    }
    const g = ctl.doc.authoring?.grid || {};
    items.push(
      { separator: true },
      { label: 'Show grid', checked: !!g.visible, onSelect: () => setGrid(ctl, { visible: !g.visible }) },
      { label: 'Snap to grid', checked: !!g.snap, onSelect: () => setGrid(ctl, { snap: !g.snap }) },
      { label: 'Show rulers', checked: !!ctl.state.rulers, onSelect: () => ctl.set({ rulers: !ctl.state.rulers }) },
      { label: 'Add vertical guide here', disabled: ro || !point, onSelect: () => addGuide(ctl, 'x', point.x) },
      { label: 'Add horizontal guide here', disabled: ro || !point, onSelect: () => addGuide(ctl, 'y', point.y) },
    );
    if (ctl.doc.authoring?.guides?.length) items.push({ label: 'Clear all guides', disabled: ro, onSelect: () => ctl.dispatch('Clear guides', (d) => { d.authoring.guides = []; }) });
  }
  return items;
}

export function setGrid(ctl, patch) {
  ctl.dispatch('Change grid', (d) => {
    d.authoring ||= { guides: [], grid: { spacing: 40 } };
    d.authoring.grid = { spacing: 40, ...(d.authoring.grid || {}), ...patch };
  });
}

export function addGuide(ctl, axis, position) {
  ctl.dispatch('Add guide', (d) => {
    d.authoring ||= { guides: [], grid: { spacing: 40 } };
    d.authoring.guides = [...(d.authoring.guides || []), { id: newId(), axis, position: Math.round(position) }];
  });
}

// ---------- slide list ----------
export function slideMenuItems(ctl, ids, { onCopyImage, onMoveToSection, onNewSection } = {}) {
  const ro = ctl.state.readOnly;
  const doc = ctl.doc;
  const allHidden = ids.every((id) => doc.slides[id]?.hidden);
  const order = slideOrder(doc);
  const first = Math.min(...ids.map((id) => order.indexOf(id)));
  const last = Math.max(...ids.map((id) => order.indexOf(id)));
  return [
    { label: 'New slide', icon: 'plus', shortcut: 'Ctrl+M', disabled: ro, onSelect: () => ctl.addSlide('title_body', ids[ids.length - 1]) },
    { label: ids.length > 1 ? 'Duplicate slides' : 'Duplicate slide', icon: 'copy', disabled: ro, onSelect: () => ctl.duplicateSlides(ids) },
    { label: ids.length > 1 ? 'Delete slides' : 'Delete slide', icon: 'trash', danger: true, disabled: ro || ids.length >= order.length, onSelect: () => ctl.deleteSlides(ids) },
    { label: allHidden ? 'Show slide' : 'Hide slide', icon: allHidden ? 'eye' : 'eyeOff', disabled: ro, onSelect: () => ctl.toggleHidden(ids) },
    { separator: true },
    { label: 'Move up', disabled: ro || first <= 0, onSelect: () => ctl.moveSlides(ids, { beforeId: order[first - 1] }) },
    { label: 'Move down', disabled: ro || last >= order.length - 1, onSelect: () => ctl.moveSlides(ids, { beforeId: order[last + 2] || null, sectionId: order[last + 2] ? null : doc.sections[doc.sections.length - 1].id }) },
    onMoveToSection && { label: 'Move to section…', disabled: ro, onSelect: onMoveToSection },
    onNewSection && { label: 'New section from selection', icon: 'section', disabled: ro, onSelect: onNewSection },
    { separator: true },
    { label: 'Copy', icon: 'copy', shortcut: shortcut('Mod+C'), onSelect: () => menuCopy(false) },
    { label: 'Cut', shortcut: shortcut('Mod+X'), disabled: ro, onSelect: () => menuCopy(true) },
    { label: 'Paste', shortcut: shortcut('Mod+V'), disabled: ro, onSelect: () => menuPaste(ctl) },
    onCopyImage && { label: 'Copy slide as image', icon: 'image', disabled: ids.length !== 1, onSelect: onCopyImage },
  ].filter(Boolean);
}

export async function renameSectionPrompt(ctl, section) {
  const name = await promptDialog({ title: 'Rename section', label: 'Section name', value: section.name || '', maxLength: 100 });
  if (name === null) return;
  const t = name.trim();
  ctl.dispatch('Rename section', (d) => ops.renameSection(d, section.id, t || null));
}

export function isBoxLike(el) {
  return geometryKind(el) === 'box';
}

export { toast };
