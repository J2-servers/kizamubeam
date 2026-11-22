---
sidebar_position: 9
title: Arranging and repeating
description: Grid and circular arrays, nesting to save material, and seamless pattern fills.
---

# Arranging and repeating

## Aligning and distributing

With several objects selected, the alignment button group in the main toolbar (and **Arrange → Align and distribute**) aligns edges or centres and distributes objects evenly. Keyboard: **L R T B** for left, right, top, bottom, **C** and **E** for the centres.

![Four name tags of different heights aligned at the bottom and spaced evenly, with the alignment button group open in the main toolbar](/img/align-distribute-en.webp)

## Arrays

**Tools → Array** makes many copies at once, with a live preview. Bézier curves are copied exactly.

- **Grid Array …** (Ctrl+Shift+A): columns and rows, with the gap between copies or the distance between their centres, direction, an offset for every other row or column (for a brick layout) and optional mirroring of every other row or column.
- **Circular Array …**: copies in a circle around a centre point.

![Grid Array dialog with 4 columns, 3 rows and 6 mm spacing; the workspace previews the copies of a key fob](/img/grid-array-dialog-en.webp)

![Circular Array dialog with 12 copies around a centre point; the workspace previews a leaf repeated in a ring](/img/circular-array-dialog-en.webp)

## Nesting

**Arrange → Nest …** (also in the Toolbox) arranges the selected parts by their real outlines, not just their bounding boxes, to save material.

![Nesting dialog with spacing, rotation, start corner and precision; sixteen parts are packed tightly into the lower left corner of the work area](/img/nesting-dialog-en.webp)

**Where:**

- the work area,
- a material size (width × height at a position), or
- a selected shape as the sheet, for example the outline of a scrap piece.

**Settings:**

- **Spacing** between parts and to the edge (allow for the kerf).
- **Rotation**: none, 180° only, or in 90°, 45°, 15° or 5° steps.
- The corner to start from.
- **Precision**: fast, normal or thorough. Normal and thorough try several orders and keep the best, and they also work on a finer grid.

The parts are packed on a grid, and the grid is coarser on a large sheet. To keep the spacing you asked for, every part first grows by half a cell diagonal — so the real spacing is **spacing + cell × 1.41**. The dialog says what that comes to for the area you chose; **Thorough**, or a smaller area, makes the grid finer.

Small parts can go into holes of larger ones, and other objects on the page are avoided. What doesn’t fit goes onto new pages. Things that belong together move together: holes drawn as separate shapes, engravings and text on a part, generator assemblies. Nesting is one undo step.

**Draw the offcut** keeps what is left of the sheet: after nesting, the remaining material is drawn as a closed outline on tool layer T1, which is never lasered. **Smallest offcut** drops anything narrower than that, so slivers do not clutter the page; set it to 0 to keep every one. Each piece loses half the part spacing around it, so the outline is always a little smaller than the real leftover, never larger. Select that outline next time and nest into it with **Selected shape (offcut)** — that is how a sheet gets used up over several jobs.

## Pattern fill

**Toolbox → Copy and Arrange → Pattern fill** fills a closed shape with a seamless pattern made of real vectors, for decorating surfaces.

![Pattern fill dialog with the honeycomb pattern and its repeat settings; on the workspace a plate is filled with honeycombs, the lettering in the middle stays free](/img/pattern-fill-dialog-en.webp)

1. Select the target shape.
2. Pick a tile: one of 13 built-in patterns (honeycomb, scales, waves, Truchet, rings, diamonds, herringbone, basket weave, stars, dots, circle grid, chevron, ogee), a pattern you saved, or your own objects (a rectangle around them sets the tile frame).
3. Choose how tiles repeat: grid, brick, half drop, mirrored, rotated by 90° (pinwheel) or hexagonal, with offset, spacing (negative = overlap), size, rotation and shift.

At the edge the pattern is clipped exactly, or only whole tiles are kept; a margin keeps the outline free, and text, images and codes on the shape are kept free automatically. Lines where tiles meet are cleaned up, so nothing is lasered twice. **Wrap edges** lets lines that leave the tile continue in the neighbouring one.

The result can be lines (to engrave, score or cut) or areas for fill layers. The pattern stays one object: double-click it to change any setting. **Save as pattern** stores tile and settings in the library.
