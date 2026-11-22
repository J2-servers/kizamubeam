---
sidebar_position: 2
title: Name tags from a list
description: Make a name tag template and laser a whole list of names in one job, from a table or a CSV file.
---

# Name tags from a list

In this tutorial you make name tags for a group, for example a class or a workshop, from a list of names. You set up the tag once and KizamuBeam lays out one copy per name.

**You need:** the list of names, in a spreadsheet or typed in, and a sheet of material for the tags (3 mm plywood or acrylic works well).

## 1. Start from the template

1. Choose **File → New from template …** and pick **Name tag**.
2. The fill-in dialog shows the fields of the template: the name, a **Second line**, the size and whether the tag gets two holes. Enter a size that suits your material, for example 80 × 30 mm, and confirm.

![Fill-in dialog of the Name tag template with its live preview: the name Anna, the second line Class 4b, width 80 mm, height 30 mm and the two holes switched on](/img/name-tag-template-en.webp)

The template is an ordinary project with [parameters](../features/templates-library.md#parameters). Open **Window → Parameters** to see them: the text on the tag contains `{Name}`, which is replaced by the value of the parameter.

You can also design your own tag: draw it, create a text parameter in the Parameters window and type `{Name}` in a text.

## 2. Fill in the table

1. Choose **File → Series from table (CSV) …**.
2. Enter the names, one row per tag. You can paste cells copied from a spreadsheet, or load a file with **Import CSV …**.
3. Under **Assign columns**, choose which column fills which parameter. Columns whose heading matches a parameter name are assigned automatically. Leave the second line on **— keep value —** if every tag should show the same text.

![Series from table dialog: a table with the single column Name and 32 rows, the column assigned to the parameter Name while the other parameters keep their value, the layout Grid and a spacing of 3 mm](/img/series-from-table-en.webp)

## 3. Lay out the series

1. Under **Layout**, choose **Grid: as many as fit on the bed, then more pages**. Set the spacing between the tags, for example 3 mm.
2. Click **Create series**.

KizamuBeam adds the tags on new pages behind the current one, with the names filled in. Your template page stays as it was, and the table is saved with the project, so you can add names later and create the series again.

![The new page Series 1 with 32 name tags in a grid of four columns, each with its own name and the same second line; the Objects window lists the template page Name tag and the series page](/img/name-tags-series-en.webp)

Long names do not change the size of the tag. Check the pages for names that are too wide for the tag, and shorten them or make the font smaller on the template page before you create the series again.

## 4. Laser the tags

1. Select a page with tags, check the layers (engraving on **Fill**, the outline on **Line**) and look at the preview (Alt+P).
2. Place the material, frame and start. Then go on with the next page.

## Variations

- **Counters and dates:** for serial numbers or a date on each job instead of a fixed list, use [variable text](../features/text.md).
- **Batches of blanks:** if you engrave ready-made blanks, cut a [jig](../features/print-and-cut.md#jigs) and use **Place on jig slots**: variable text counts up per slot.
- **Your own template:** **File → Save as template …** turns your tag into a template that asks for its values, with your own fields and sliders.
