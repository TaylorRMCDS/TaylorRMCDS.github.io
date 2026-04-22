# Copilot Instructions: Database Initialization Creator Kit

This document describes how each feature of the Database Initialization Creator Kit should be implemented in `database-initialization-creator-kit.html`. The page is a self-contained, single-file tool built with plain HTML, CSS, and vanilla JavaScript (no external dependencies).

---

## Page Layout

The page is divided into two areas:

- **Toolbar** – a fixed panel at the top (or left side) containing action buttons: *Add Table*, *Save SQL*, and a *Clear Canvas* button.
- **Canvas** – the large remaining area where table cards are placed and manipulated.

```
┌──────────────────────────────────────────────────┐
│  [Add Table]  [Save SQL]  [Clear Canvas]         │  ← Toolbar
├──────────────────────────────────────────────────┤
│                                                  │
│        (draggable table cards appear here)       │  ← Canvas
│                                                  │
│   SVG overlay for relationship connector lines   │
│                                                  │
└──────────────────────────────────────────────────┘
```

The canvas `<div>` uses `position: relative; overflow: hidden;` and fills the remaining viewport height. An `<svg>` element sits on top of the canvas at the same size with `pointer-events: none` so it never blocks mouse events on table cards; connector lines are drawn into this SVG.

---

## 1. Adding a Table (click-to-add)

**Trigger:** Clicking the *Add Table* button drops a new table card onto the canvas at a default or slightly randomised position (e.g., 40 px offset per new table so they don't stack perfectly).

**Table card DOM structure:**

```html
<div class="table-card" data-id="<uuid>">
  <div class="table-header">
    <span class="table-name">NewTable</span>
    <div class="table-actions">
      <button class="btn-add-field">+ Field</button>
      <button class="btn-connect">⤢ Connect</button>
      <button class="btn-delete-table">✕</button>
    </div>
  </div>
  <ul class="field-list">
    <!-- field rows injected here -->
  </ul>
</div>
```

Each card is assigned a unique `data-id` (use `crypto.randomUUID()` or a simple counter). The card is absolutely positioned on the canvas using `style="left: Xpx; top: Ypx;"`.

---

## 2. Renaming a Table

**Trigger:** Double-clicking the `<span class="table-name">` element.

**Behaviour:**
1. Replace the `<span>` with an `<input type="text">` pre-filled with the current name.
2. Focus the input and select all text.
3. On `blur` or `Enter` keypress, validate that the name is non-empty and contains only alphanumeric characters/underscores.
4. Swap the input back to a `<span>` showing the (possibly updated) name.
5. Update the internal data model entry for this table.
6. Re-render any SVG connector labels that reference this table name.

---

## 3. Dragging Tables

**Trigger:** `mousedown` on the table header bar (`.table-header`), followed by `mousemove` on the `document`, ended by `mouseup`.

**Implementation:**
1. On `mousedown` record the offset between the mouse position and the card's current `left`/`top`.
2. On `mousemove` (attached to `document` to avoid losing the drag when the cursor moves quickly) compute `newLeft = e.clientX - offsetX` and `newTop = e.clientY - offsetY`, clamped so the card stays within the canvas bounds.
3. Set `card.style.left` and `card.style.top` accordingly.
4. After each move, call `redrawConnectors()` to update any SVG lines attached to this table.
5. On `mouseup` remove the `mousemove` and `mouseup` listeners.

Do **not** use the HTML5 Drag-and-Drop API; use raw mouse events for precise control.

---

## 4. Adding Fields

**Trigger:** Clicking the *+ Field* button inside a table card.

**Behaviour:**
Each field is represented as a `<li>` element inside `.field-list`:

```html
<li class="field-row" data-field-id="<uuid>">
  <input class="field-name"  type="text" placeholder="field_name" />
  <select class="field-type">
    <option>INT</option>
    <option>VARCHAR(255)</option>
    <option>TEXT</option>
    <option>BOOLEAN</option>
    <option>DATE</option>
    <option>DATETIME</option>
    <option>FLOAT</option>
    <option>DECIMAL(10,2)</option>
    <option>UUID</option>
  </select>
  <button class="btn-delete-field">✕</button>
</li>
```

The field name input and type select are live-bound to the data model via `input`/`change` event listeners so no explicit save step is needed for individual fields.

---

## 5. Deleting Tables

**Trigger:** Clicking the *✕* button in a table card's header (`.btn-delete-table`).

**Behaviour:**
1. Remove the card element from the DOM.
2. Remove the table entry from the internal data model.
3. Remove all connector entries in the data model that reference this table's `id`.
4. Call `redrawConnectors()` to erase any SVG lines that were attached to the deleted table.

---

## 6. Connecting Two Tables (Relationships)

**Trigger:** Clicking the *⤢ Connect* button on a source table card puts the canvas into *connection mode*. A visible indicator (e.g., a highlighted border on the source card and a cursor change on the canvas) shows the mode is active. Clicking a second (different) table card while in connection mode completes the connection.

**Relationship types** – after selecting the target table a small modal or inline dropdown appears asking the user to choose the relationship type:

| Value stored | Display label |
|---|---|
| `one_to_one` | One-to-One (1 : 1) |
| `one_to_many` | One-to-Many (1 : N) |
| `many_to_one` | Many-to-One (N : 1) |
| `many_to_many` | Many-to-Many (N : N) |

**Data model entry for a relationship:**
```json
{
  "id": "<uuid>",
  "sourceTableId": "<uuid>",
  "targetTableId": "<uuid>",
  "type": "one_to_many"
}
```

**Visual representation (SVG connectors):**
- Draw a line from the centre-right edge of the source card to the centre-left edge of the target card (or the nearest edges if the cards are positioned differently).
- Show the relationship type as a short text label at the midpoint of the line.
- Use a small arrowhead or crow's-foot notation at the target end to indicate directionality.
- The `redrawConnectors()` function clears the SVG, then iterates all relationship entries in the data model and redraws each line based on the current card positions.

Clicking an existing connector line selects it and shows a *Delete Relationship* button; clicking that button removes the relationship from the data model and calls `redrawConnectors()`.

---

## 7. Internal Data Model

Maintain a plain JavaScript object (or two arrays) that mirrors exactly what is shown on the canvas:

```js
const state = {
  tables: [
    {
      id: "uuid-1",
      name: "users",
      x: 100,
      y: 80,
      fields: [
        { id: "f-uuid-1", name: "id",    type: "INT" },
        { id: "f-uuid-2", name: "email", type: "VARCHAR(255)" }
      ]
    }
  ],
  relationships: [
    {
      id: "r-uuid-1",
      sourceTableId: "uuid-1",
      targetTableId: "uuid-2",
      type: "one_to_many"
    }
  ]
};
```

All DOM manipulation functions read from and write to `state` to keep the visual canvas and data in sync.

---

## 8. Saving – Generating the SQL Script

**Trigger:** Clicking the *Save SQL* button.

**Process:**
1. Validate that every table has a non-empty name and that field names are non-empty.  Show an inline error message for any violations.
2. Build a SQL string from `state` following the template below.
3. Present the SQL in a `<textarea>` inside a modal overlay so the user can copy it.  Include a *Download .sql* button that uses a `<a download="schema.sql">` trick to save the file.

**SQL generation rules:**

```
For each table in state.tables:
  CREATE TABLE `<table.name>` (
    For each field in table.fields:
      `<field.name>` <field.type> [NOT NULL],
    For one_to_many / many_to_one relationships where this table is the "many" side:
      `<otherTableName>_id` INT,
      FOREIGN KEY (`<otherTableName>_id`) REFERENCES `<otherTableName>`(`id`)
  );

For each many_to_many relationship:
  CREATE TABLE `<sourceTable.name>_<targetTable.name>` (
    `<sourceTable.name>_id` INT NOT NULL,
    `<targetTable.name>_id` INT NOT NULL,
    PRIMARY KEY (`<sourceTable.name>_id`, `<targetTable.name>_id`),
    FOREIGN KEY (`<sourceTable.name>_id`) REFERENCES `<sourceTable.name>`(`id`),
    FOREIGN KEY (`<targetTable.name>_id`) REFERENCES `<targetTable.name>`(`id`)
  );
```

---

## Implementation Notes

- Keep everything in one HTML file (`database-initialization-creator-kit.html`) using `<style>` and `<script>` tags.  No build step, no npm, no external libraries.
- Use CSS custom properties (variables) for colours and spacing so the visual style is easy to adjust.
- Keep the data model as the single source of truth; never read layout state back from the DOM.
- SVG connector lines should use `<line>` or `<path>` elements; apply `marker-end` to draw arrowheads using an SVG `<defs>` `<marker>`.
- Escape user-provided table/field names (backtick-wrap and strip internal backticks) before inserting them into the generated SQL to prevent injection in the output file.
- Support keyboard accessibility: all buttons reachable by Tab, Enter triggers rename confirmation, Escape cancels connection mode.
