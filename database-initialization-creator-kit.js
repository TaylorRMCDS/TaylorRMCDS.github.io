(function () {
  'use strict';

  /* 
     State
   */
  const state = {
    tables: [],        // { id, name, x, y, fields: [{ id, name, type }] }
    relationships: []  // { id, sourceTableId, targetTableId, type }
  };

  /* 
     DOM refs
   */
  const canvas            = document.getElementById('canvas');
  const svgOverlay        = document.getElementById('svg-overlay');
  const connectIndicator  = document.getElementById('connect-mode-indicator');
  const relModalOverlay   = document.getElementById('rel-modal-overlay');
  const sqlModalOverlay   = document.getElementById('sql-modal-overlay');
  const sqlOutput         = document.getElementById('sql-output');
  const connectorDeleteBtn= document.getElementById('connector-delete-btn');
  const errorToast        = document.getElementById('error-toast');
  const singleFieldInput  = document.getElementById('single-field-input');
  const bulkFieldInput    = document.getElementById('bulk-field-input');
  const addPaneFieldBtn   = document.getElementById('btn-add-pane-field');
  const addBulkFieldsBtn  = document.getElementById('btn-add-bulk-fields');
  const paneFieldListEl   = document.getElementById('pane-field-list');

  const paneFields = [];

  /* 
     Utility
   */
  let _uidCounter = 0;
  function uid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // Fallback: combine timestamp + counter for uniqueness
    return 'id-' + Date.now().toString(36) + '-' + (++_uidCounter).toString(36);
  }

  function escapeBacktick(s) {
    return s.replace(/`/g, '');
  }

  let cardOffset = 0;

  function showError(msg, durationMs = 3500) {
    errorToast.textContent = msg;
    errorToast.classList.add('active');
    setTimeout(() => errorToast.classList.remove('active'), durationMs);
  }

  function addPaneField(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    paneFields.push({ id: uid(), name: trimmed });
    renderPaneFields();
  }

  function addPaneFieldRaw(name) {
    const value = (name || '').trim() || 'unnamed_field';
    paneFields.push({ id: uid(), name: value });
    renderPaneFields();
  }

  function addPaneFieldsFromText(multilineText) {
    multilineText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .forEach(addPaneField);
  }

  function removePaneField(fieldId) {
    const idx = paneFields.findIndex(f => f.id === fieldId);
    if (idx === -1) return;
    paneFields.splice(idx, 1);
    renderPaneFields();
  }

  function getPaneFieldById(fieldId) {
    return paneFields.find(f => f.id === fieldId) || null;
  }

  function renderPaneFields() {
    paneFieldListEl.innerHTML = '';
    paneFields.forEach(field => {
      const li = document.createElement('li');
      li.className = 'pane-field-tile';
      li.dataset.fieldId = field.id;
      li.draggable = true;

      const name = document.createElement('span');
      name.className = 'pane-field-name';
      name.textContent = field.name;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-remove-pane-field';
      removeBtn.textContent = 'Remove';
      removeBtn.setAttribute('aria-label', `Remove ${field.name}`);
      removeBtn.addEventListener('click', () => removePaneField(field.id));

      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/pane-field-id', field.id);
        e.dataTransfer.setData('text/plain', field.id);
        e.dataTransfer.effectAllowed = 'move';
        li.classList.add('dragging');
      });

      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
      });

      li.appendChild(name);
      li.appendChild(removeBtn);
      paneFieldListEl.appendChild(li);
    });
  }

  /* 
     Connection Mode State
   */
  let connectMode = false;
  let connectSourceId = null;

  function enterConnectMode(sourceId) {
    connectMode = true;
    connectSourceId = sourceId;
    canvas.classList.add('connect-mode');
    connectIndicator.classList.add('active');
    // Highlight source card
    document.querySelectorAll('.table-card').forEach(c => {
      c.classList.toggle('connect-source', c.dataset.id === sourceId);
    });
  }

  function exitConnectMode() {
    connectMode = false;
    connectSourceId = null;
    canvas.classList.remove('connect-mode');
    connectIndicator.classList.remove('active');
    document.querySelectorAll('.table-card').forEach(c => c.classList.remove('connect-source'));
  }

  /* 
     Port Drag-to-Connect
   */
  let portDragState = null;
  let tempConnLine  = null;

  function getPortCenter(tableId, side) {
    const r = getCardRect(tableId);
    if (!r) return null;
    switch (side) {
      case 'top':    return { x: r.left + r.width / 2, y: r.top };
      case 'right':  return { x: r.left + r.width,      y: r.top + r.height / 2 };
      case 'bottom': return { x: r.left + r.width / 2, y: r.top + r.height };
      case 'left':   return { x: r.left,                y: r.top + r.height / 2 };
      default:       return null;
    }
  }

  function startPortConnect(tableId, side, e) {
    e.stopPropagation();
    e.preventDefault();

    const coords = getPortCenter(tableId, side);
    if (!coords) return;

    // Highlight source card and show crosshair cursor
    document.querySelectorAll('.table-card').forEach(c =>
      c.classList.toggle('connect-source', c.dataset.id === tableId)
    );
    canvas.classList.add('connect-mode');

    portDragState = { sourceId: tableId, moved: false };

    // Temporary dashed line showing the in-progress connection
    tempConnLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tempConnLine.setAttribute('x1', coords.x);
    tempConnLine.setAttribute('y1', coords.y);
    tempConnLine.setAttribute('x2', coords.x);
    tempConnLine.setAttribute('y2', coords.y);
    tempConnLine.setAttribute('stroke', 'var(--color-connector)');
    tempConnLine.setAttribute('stroke-width', '2');
    tempConnLine.setAttribute('stroke-dasharray', '6 3');
    tempConnLine.setAttribute('marker-end', 'url(#arrowhead)');
    tempConnLine.style.pointerEvents = 'none';
    svgOverlay.appendChild(tempConnLine);

    document.addEventListener('mousemove', onPortDragMove);
    document.addEventListener('mouseup',   onPortDragEnd);
  }

  function onPortDragMove(e) {
    if (!portDragState) return;
    const r = canvas.getBoundingClientRect();
    tempConnLine.setAttribute('x2', e.clientX - r.left);
    tempConnLine.setAttribute('y2', e.clientY - r.top);
    portDragState.moved = true;
  }

  function onPortDragEnd(e) {
    document.removeEventListener('mousemove', onPortDragMove);
    document.removeEventListener('mouseup',   onPortDragEnd);
    if (!portDragState) return;

    const { sourceId, moved } = portDragState;

    // Clean up temp line and visual cues
    if (tempConnLine) { tempConnLine.remove(); tempConnLine = null; }
    document.querySelectorAll('.table-card').forEach(c => c.classList.remove('connect-source'));
    canvas.classList.remove('connect-mode');
    portDragState = null;

    if (!moved) {
      // Pure click on port  enter click-to-connect mode
      enterConnectMode(sourceId);
      return;
    }

    // Drag: resolve the card under the cursor (hide SVG overlay briefly so it doesn't intercept)
    svgOverlay.style.visibility = 'hidden';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    svgOverlay.style.visibility = '';

    const targetCard = el ? el.closest('.table-card') : null;
    const targetId   = targetCard ? targetCard.dataset.id : null;

    if (!targetId || targetId === sourceId) return;
    openRelModal(sourceId, targetId);
  }

  /* 
     Selected Connector State
   */
  let selectedRelId = null;

  function selectConnector(relId, x, y) {
    selectedRelId = relId;
    connectorDeleteBtn.classList.add('active');
    connectorDeleteBtn.style.left = x + 'px';
    connectorDeleteBtn.style.top  = (y - 36) + 'px';
    redrawConnectors();
  }

  function deselectConnector() {
    if (!selectedRelId) return;
    selectedRelId = null;
    connectorDeleteBtn.classList.remove('active');
    redrawConnectors();
  }

  /* 
     SVG Connectors
   */
  function getCardRect(tableId) {
    const el = document.querySelector(`.table-card[data-id="${tableId}"]`);
    if (!el) return null;
    return {
      left:   el.offsetLeft,
      top:    el.offsetTop,
      width:  el.offsetWidth,
      height: el.offsetHeight
    };
  }

  function redrawConnectors() {
    // Remove all existing connector groups
    svgOverlay.querySelectorAll('.connector-group').forEach(g => g.remove());

    state.relationships.forEach(rel => {
      const src = getCardRect(rel.sourceTableId);
      const tgt = getCardRect(rel.targetTableId);
      if (!src || !tgt) return;

      const selected = rel.id === selectedRelId;

      // Determine best edge connection points
      const srcCX = src.left + src.width / 2;
      const srcCY = src.top  + src.height / 2;
      const tgtCX = tgt.left + tgt.width / 2;
      const tgtCY = tgt.top  + tgt.height / 2;

      // Pick edges: right/left or top/bottom based on relative positions
      let x1, y1, x2, y2;
      const dx = tgtCX - srcCX;
      const dy = tgtCY - srcCY;

      if (Math.abs(dx) >= Math.abs(dy)) {
        // Horizontal connection
        if (dx >= 0) {
          x1 = src.left + src.width;  y1 = srcCY;
          x2 = tgt.left;              y2 = tgtCY;
        } else {
          x1 = src.left;              y1 = srcCY;
          x2 = tgt.left + tgt.width; y2 = tgtCY;
        }
      } else {
        // Vertical connection
        if (dy >= 0) {
          x1 = srcCX; y1 = src.top + src.height;
          x2 = tgtCX; y2 = tgt.top;
        } else {
          x1 = srcCX; y1 = src.top;
          x2 = tgtCX; y2 = tgt.top + tgt.height;
        }
      }

      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      const strokeColor = selected ? 'var(--color-connector-selected)' : 'var(--color-connector)';
      const markerId    = selected ? 'arrowhead-selected' : 'arrowhead';

      const relLabel = {
        one_to_one:   '1 : 1',
        one_to_many:  '1 : N',
        many_to_one:  'N : 1',
        many_to_many: 'N : N'
      }[rel.type] || rel.type;

      // Group
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.classList.add('connector-group');
      g.dataset.relId = rel.id;

      // Invisible hit-area line (thicker, transparent)
      const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hitLine.setAttribute('x1', x1); hitLine.setAttribute('y1', y1);
      hitLine.setAttribute('x2', x2); hitLine.setAttribute('y2', y2);
      hitLine.setAttribute('stroke', 'transparent');
      hitLine.setAttribute('stroke-width', '12');
      hitLine.style.pointerEvents = 'stroke';
      hitLine.style.cursor = 'pointer';
      hitLine.classList.add('connector-hit');

      // Visible line
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', strokeColor);
      line.setAttribute('stroke-width', selected ? '2.5' : '1.8');
      line.setAttribute('marker-end', `url(#${markerId})`);
      line.classList.add('connector');

      // Label background rect
      const LABEL_PAD_X = 6, LABEL_PAD_Y = 3;
      const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      labelText.setAttribute('x', midX);
      labelText.setAttribute('y', midY);
      labelText.setAttribute('text-anchor', 'middle');
      labelText.setAttribute('dominant-baseline', 'middle');
      labelText.setAttribute('font-size', '11');
      labelText.setAttribute('font-weight', 'bold');
      labelText.setAttribute('fill', selected ? 'var(--color-connector-selected)' : '#fff');
      labelText.textContent = relLabel;

      // Background pill
      const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const approxW = relLabel.length * 6.5 + LABEL_PAD_X * 2;
      const approxH = 16 + LABEL_PAD_Y * 2;
      labelBg.setAttribute('x', midX - approxW / 2);
      labelBg.setAttribute('y', midY - approxH / 2);
      labelBg.setAttribute('width', approxW);
      labelBg.setAttribute('height', approxH);
      labelBg.setAttribute('rx', '5');
      labelBg.setAttribute('fill', selected ? '#fee2e2' : 'var(--color-connector)');

      // Click handlers on group
      [hitLine, line, labelBg, labelText].forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (selectedRelId === rel.id) {
            deselectConnector();
          } else {
            selectConnector(rel.id, e.clientX, e.clientY);
          }
        });
      });

      g.appendChild(hitLine);
      g.appendChild(line);
      g.appendChild(labelBg);
      g.appendChild(labelText);
      svgOverlay.appendChild(g);
    });
  }

  /* 
     Field Management
   */
  function addFieldToModel(tableId, fieldDef) {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return;
    table.fields.push(fieldDef);
  }

  function removeFieldFromModel(tableId, fieldId) {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return;
    table.fields = table.fields.filter(f => f.id !== fieldId);
  }

  function buildFieldRow(tableId, fieldDef) {
    const li = document.createElement('li');
    li.className = 'field-row';
    li.dataset.fieldId = fieldDef.id;
    li.draggable = true;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'field-name';
    nameInput.placeholder = 'field_name';
    nameInput.value = fieldDef.name;
    nameInput.setAttribute('aria-label', 'Field name');

    const typeSelect = document.createElement('select');
    typeSelect.className = 'field-type';
    typeSelect.setAttribute('aria-label', 'Field type');
    ['INT','VARCHAR(255)','TEXT','BOOLEAN','DATE','DATETIME','FLOAT','DECIMAL(10,2)','UUID'].forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === fieldDef.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete-field';
    delBtn.textContent = '';
    delBtn.setAttribute('aria-label', 'Delete field');
    delBtn.title = 'Delete field';

    // Live bind to state
    nameInput.addEventListener('input', () => {
      fieldDef.name = nameInput.value;
    });

    typeSelect.addEventListener('change', () => {
      fieldDef.type = typeSelect.value;
    });

    delBtn.addEventListener('click', () => {
      removeFieldFromModel(tableId, fieldDef.id);
      li.remove();
    });

    li.addEventListener('dragstart', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'BUTTON')) {
        e.preventDefault();
        return;
      }
      const payload = {
        sourceTableId: tableId,
        fieldId: fieldDef.id,
        name: fieldDef.name,
        type: fieldDef.type
      };
      e.dataTransfer.setData('application/table-field', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });

    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
    });

    li.appendChild(nameInput);
    li.appendChild(typeSelect);
    li.appendChild(delBtn);
    return li;
  }

  /* 
     Table Card Creation
   */
  function createTableCard(tableData) {
    const card = document.createElement('div');
    card.className = 'table-card';
    card.dataset.id = tableData.id;
    card.style.left = tableData.x + 'px';
    card.style.top  = tableData.y + 'px';

    /* Header */
    const header = document.createElement('div');
    header.className = 'table-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'table-name';
    nameSpan.textContent = tableData.name;
    nameSpan.title = 'Double-click to rename';

    const actions = document.createElement('div');
    actions.className = 'table-actions';

    const deleteTableBtn = document.createElement('button');
    deleteTableBtn.className = 'btn-delete-table';
    deleteTableBtn.textContent = '';
    deleteTableBtn.setAttribute('aria-label', 'Delete table');
    deleteTableBtn.title = 'Delete table';

    actions.appendChild(deleteTableBtn);
    header.appendChild(nameSpan);
    header.appendChild(actions);

    /* Field list */
    const fieldList = document.createElement('ul');
    fieldList.className = 'field-list';

    // Render existing fields (e.g. when reconstructing)
    tableData.fields.forEach(f => fieldList.appendChild(buildFieldRow(tableData.id, f)));

    card.appendChild(header);
    card.appendChild(fieldList);

    card.addEventListener('dragover', (e) => {
      const hasPaneFieldId =
        e.dataTransfer.types.includes('text/pane-field-id') ||
        e.dataTransfer.types.includes('text/plain');
      const hasTableFieldPayload = e.dataTransfer.types.includes('application/table-field');
      if (!hasPaneFieldId && !hasTableFieldPayload) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drop-target');
    });

    card.addEventListener('dragleave', (e) => {
      const nextEl = e.relatedTarget;
      if (nextEl && card.contains(nextEl)) return;
      card.classList.remove('drop-target');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drop-target');

      const tableFieldPayload = e.dataTransfer.getData('application/table-field');
      if (tableFieldPayload) {
        let parsed;
        try {
          parsed = JSON.parse(tableFieldPayload);
        } catch {
          return;
        }

        if (!parsed || !parsed.sourceTableId || !parsed.fieldId) return;
        if (parsed.sourceTableId === tableData.id) return;

        const sourceTable = state.tables.find(t => t.id === parsed.sourceTableId);
        if (!sourceTable) return;
        const sourceField = sourceTable.fields.find(f => f.id === parsed.fieldId);
        if (!sourceField) return;

        removeFieldFromModel(parsed.sourceTableId, parsed.fieldId);
        const sourceRow = document.querySelector(
          `.table-card[data-id="${parsed.sourceTableId}"] .field-row[data-field-id="${parsed.fieldId}"]`
        );
        if (sourceRow) sourceRow.remove();

        const movedField = {
          id: uid(),
          name: sourceField.name,
          type: sourceField.type
        };
        addFieldToModel(tableData.id, movedField);
        fieldList.appendChild(buildFieldRow(tableData.id, movedField));
        return;
      }

      const fieldId =
        e.dataTransfer.getData('text/pane-field-id') ||
        e.dataTransfer.getData('text/plain');
      if (!fieldId) return;

      const paneField = getPaneFieldById(fieldId);
      if (!paneField) return;

      const fieldDef = { id: uid(), name: paneField.name, type: 'INT' };
      addFieldToModel(tableData.id, fieldDef);
      fieldList.appendChild(buildFieldRow(tableData.id, fieldDef));
      removePaneField(fieldId);
    });

    /*  Double-click to rename  */
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'table-name-input';
      input.value = tableData.name;
      input.setAttribute('aria-label', 'Table name');
      header.replaceChild(input, nameSpan);
      input.focus();
      input.select();

      function finishRename() {
        const raw = input.value.trim();
        const valid = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(raw);
        const finalName = (valid && raw.length > 0) ? raw : tableData.name;
        if (!valid && raw.length > 0) {
          showError('Table name must start with a letter/underscore and contain only alphanumeric characters or underscores.');
        }
        nameSpan.textContent = finalName;
        tableData.name = finalName;
        header.replaceChild(nameSpan, input);
        redrawConnectors();
      }

      input.addEventListener('blur', finishRename);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); finishRename(); }
        if (ev.key === 'Escape') { input.value = tableData.name; finishRename(); }
      });
    });

    /*  Delete Table  */
    deleteTableBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.tables = state.tables.filter(t => t.id !== tableData.id);
      state.relationships = state.relationships.filter(
        r => r.sourceTableId !== tableData.id && r.targetTableId !== tableData.id
      );
      card.remove();
      if (selectedRelId) {
        const stillExists = state.relationships.some(r => r.id === selectedRelId);
        if (!stillExists) deselectConnector();
      }
      redrawConnectors();
    });

    /*  Drag  */
    header.addEventListener('mousedown', (e) => {
      // Don't drag when clicking buttons or during rename
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      if (connectMode) return;

      e.preventDefault();
      const canvasRect = canvas.getBoundingClientRect();
      const offsetX = e.clientX - card.offsetLeft;
      const offsetY = e.clientY - card.offsetTop;

      function onMove(ev) {
        const canvasBounds = canvas.getBoundingClientRect();
        let newLeft = ev.clientX - offsetX;
        let newTop  = ev.clientY - offsetY;
        // Clamp within canvas
        newLeft = Math.max(0, Math.min(newLeft, canvasBounds.width  - card.offsetWidth));
        newTop  = Math.max(0, Math.min(newTop,  canvasBounds.height - card.offsetHeight));
        card.style.left = newLeft + 'px';
        card.style.top  = newTop  + 'px';
        tableData.x = newLeft;
        tableData.y = newTop;
        redrawConnectors();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    /*  Click card in connect mode  */
    card.addEventListener('click', (e) => {
      if (!connectMode) return;
      const targetId = card.dataset.id;
      if (targetId === connectSourceId) {
        exitConnectMode();
        return;
      }
      // Store pending relationship
      const pendingSourceId = connectSourceId;
      const pendingTargetId = targetId;
      exitConnectMode();
      openRelModal(pendingSourceId, pendingTargetId);
    });

    /*  Edge Ports  */
    ['top', 'right', 'bottom', 'left'].forEach(side => {
      const port = document.createElement('div');
      port.className = 'edge-port';
      port.dataset.side = side;
      port.title = 'Drag or click to connect';
      port.addEventListener('mousedown', (e) => startPortConnect(tableData.id, side, e));
      card.appendChild(port);
    });

    canvas.appendChild(card);
    return card;
  }

  /* 
     Relationship Modal
   */
  let relModalResolve = null;

  function openRelModal(sourceId, targetId) {
    relModalOverlay.classList.add('active');
    relModalOverlay.querySelector('.rel-options').focus?.();

    relModalResolve = (type) => {
      relModalOverlay.classList.remove('active');
      if (!type) return;
      const rel = { id: uid(), sourceTableId: sourceId, targetTableId: targetId, type };
      state.relationships.push(rel);
      redrawConnectors();
    };
  }

  relModalOverlay.querySelectorAll('.rel-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (relModalResolve) relModalResolve(btn.dataset.type);
      relModalResolve = null;
    });
  });

  document.getElementById('rel-modal-cancel').addEventListener('click', () => {
    if (relModalResolve) relModalResolve(null);
    relModalResolve = null;
  });

  /* 
     Toolbar Buttons
   */
  document.getElementById('btn-add-table').addEventListener('click', () => {
    const offset = 60 + (cardOffset % 10) * 40;
    cardOffset++;
    const tableData = {
      id: uid(),
      name: 'NewTable',
      x: offset,
      y: offset,
      fields: []
    };
    state.tables.push(tableData);
    createTableCard(tableData);
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    if (!confirm('Clear all tables and relationships?')) return;
    state.tables = [];
    state.relationships = [];
    canvas.querySelectorAll('.table-card').forEach(c => c.remove());
    svgOverlay.querySelectorAll('.connector-group').forEach(g => g.remove());
    deselectConnector();
    exitConnectMode();
    cardOffset = 0;
  });

  document.getElementById('btn-save-sql').addEventListener('click', () => {
    const errors = validateState();
    if (errors.length) {
      showError(errors.join(' | '), 5000);
      return;
    }
    const sql = generateSQL();
    sqlOutput.value = sql;
    sqlModalOverlay.classList.add('active');
    sqlOutput.focus();
  });

  document.getElementById('btn-close-sql').addEventListener('click', () => {
    sqlModalOverlay.classList.remove('active');
  });

  addPaneFieldBtn.addEventListener('click', () => {
    addPaneField(singleFieldInput.value);
    singleFieldInput.value = '';
    singleFieldInput.focus();
  });

  singleFieldInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addPaneField(singleFieldInput.value);
    singleFieldInput.value = '';
  });

  addBulkFieldsBtn.addEventListener('click', () => {
    addPaneFieldsFromText(bulkFieldInput.value);
    bulkFieldInput.value = '';
    bulkFieldInput.focus();
  });

  paneFieldListEl.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/table-field')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    paneFieldListEl.classList.add('drop-target');
  });

  paneFieldListEl.addEventListener('dragleave', (e) => {
    const nextEl = e.relatedTarget;
    if (nextEl && paneFieldListEl.contains(nextEl)) return;
    paneFieldListEl.classList.remove('drop-target');
  });

  paneFieldListEl.addEventListener('drop', (e) => {
    e.preventDefault();
    paneFieldListEl.classList.remove('drop-target');

    const tableFieldPayload = e.dataTransfer.getData('application/table-field');
    if (!tableFieldPayload) return;

    let parsed;
    try {
      parsed = JSON.parse(tableFieldPayload);
    } catch {
      return;
    }

    if (!parsed || !parsed.sourceTableId || !parsed.fieldId) return;

    const sourceTable = state.tables.find(t => t.id === parsed.sourceTableId);
    if (!sourceTable) return;
    const sourceField = sourceTable.fields.find(f => f.id === parsed.fieldId);
    if (!sourceField) return;

    removeFieldFromModel(parsed.sourceTableId, parsed.fieldId);
    const sourceRow = document.querySelector(
      `.table-card[data-id="${parsed.sourceTableId}"] .field-row[data-field-id="${parsed.fieldId}"]`
    );
    if (sourceRow) sourceRow.remove();

    addPaneFieldRaw(sourceField.name);
  });

  document.getElementById('btn-download-sql').addEventListener('click', () => {
    const blob = new Blob([sqlOutput.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema.sql';
    a.click();
    URL.revokeObjectURL(url);
  });

  connectorDeleteBtn.addEventListener('click', () => {
    if (!selectedRelId) return;
    state.relationships = state.relationships.filter(r => r.id !== selectedRelId);
    deselectConnector();
  });

  /* 
     Deselect connector / cancel connect mode on canvas click
   */
  canvas.addEventListener('click', (e) => {
    deselectConnector();
    if (!e.target.closest('.table-card')) exitConnectMode();
  });

  /* 
     Double-click canvas to create a new table
   */
  canvas.addEventListener('dblclick', (e) => {
    if (e.target.closest('.table-card')) return;
    if (connectMode || portDragState) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const tableData = {
      id: uid(),
      name: 'NewTable',
      // Offset so the card is roughly centred on the cursor
      x: Math.max(0, x - 110),  // ~half of min-width (220px)
      y: Math.max(0, y - 20),   // ~half of header height
      fields: []
    };
    state.tables.push(tableData);
    createTableCard(tableData);
  });

  /* 
     Keyboard: Escape cancels connect mode / modals
   */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (connectMode) { exitConnectMode(); return; }
      if (relModalOverlay.classList.contains('active')) {
        if (relModalResolve) relModalResolve(null);
        relModalResolve = null;
        return;
      }
      if (sqlModalOverlay.classList.contains('active')) {
        sqlModalOverlay.classList.remove('active');
        return;
      }
      deselectConnector();
    }
  });

  /* 
     Validation
   */
  function validateState() {
    const errors = [];
    state.tables.forEach(t => {
      if (!t.name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t.name)) {
        errors.push(`Table has invalid name: "${t.name}".`);
      }
      t.fields.forEach(f => {
        if (!f.name.trim()) {
          errors.push(`Table "${t.name}" has a field with an empty name.`);
        }
      });
    });
    return errors;
  }

  /* 
     SQL Generation
   */
  function generateSQL() {
    const lines = [];

    state.tables.forEach(table => {
      const tName = escapeBacktick(table.name);
      lines.push(`CREATE TABLE \`${tName}\` (`);

      const colLines = [];

      // Every table gets an auto-increment primary key
      colLines.push(`  \`id\` INT NOT NULL AUTO_INCREMENT PRIMARY KEY`);

      table.fields.forEach(f => {
        const fName = escapeBacktick(f.name.trim());
        colLines.push(`  \`${fName}\` ${f.type} NOT NULL`);
      });

      // Foreign keys for one_to_many / many_to_one where this table is the "many" side
      state.relationships.forEach(rel => {
        const isOneToMany = rel.type === 'one_to_many' && rel.targetTableId === table.id;
        const isManyToOne = rel.type === 'many_to_one' && rel.sourceTableId === table.id;

        if (isOneToMany || isManyToOne) {
          const otherTableId = isOneToMany ? rel.sourceTableId : rel.targetTableId;
          const otherTable = state.tables.find(t => t.id === otherTableId);
          if (!otherTable) return;
          const otherName = escapeBacktick(otherTable.name);
          colLines.push(`  \`${otherName}_id\` INT NOT NULL`);
          colLines.push(`  FOREIGN KEY (\`${otherName}_id\`) REFERENCES \`${otherName}\`(\`id\`)`);
        }
      });

      lines.push(colLines.join(',\n'));
      lines.push(');');
      lines.push('');
    });

    // Many-to-many junction tables
    state.relationships
      .filter(r => r.type === 'many_to_many')
      .forEach(rel => {
        const src = state.tables.find(t => t.id === rel.sourceTableId);
        const tgt = state.tables.find(t => t.id === rel.targetTableId);
        if (!src || !tgt) return;
        const sName = escapeBacktick(src.name);
        const tName = escapeBacktick(tgt.name);
        lines.push(`CREATE TABLE \`${sName}_${tName}\` (`);
        lines.push(`  \`${sName}_id\` INT NOT NULL,`);
        lines.push(`  \`${tName}_id\` INT NOT NULL,`);
        lines.push(`  PRIMARY KEY (\`${sName}_id\`, \`${tName}_id\`),`);
        lines.push(`  FOREIGN KEY (\`${sName}_id\`) REFERENCES \`${sName}\`(\`id\`),`);
        lines.push(`  FOREIGN KEY (\`${tName}_id\`) REFERENCES \`${tName}\`(\`id\`)`);
        lines.push(');');
        lines.push('');
      });

    return lines.join('\n');
  }

})();

