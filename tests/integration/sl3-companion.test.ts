// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString } from "pdf-lib";
import { spawnSync } from "node:child_process";
import { companionSl3 } from "../_helpers/companionSl3";
import { sl3Fixture } from "../_helpers/sl3Fixture";
import { letterSchema } from "../../companion/letterSchema";
import { validateLetter } from "../../companion/validateLetter";
import { renderToFile } from "../../companion/renderToFile";
import { expectSl3Certification } from "../_helpers/sl3Certification";

describe("SL-3 production export", () => {
  it.each(["portrait", "landscape"] as const)("renders the complete %s certification and locates authentication after cover overflow", async (orientation) => {
    const root = await mkdtemp(join(tmpdir(), `dondocs-sl3-cert-${orientation}-`));
    const input = companionSl3();
    input.publication!.sl3!.orientation = orientation;
    const endItem = input.publication!.endItems![0];
    input.publication!.endItems = Array.from({ length: 7 }, (_, i) => ({ ...endItem, model: `MODEL-${i + 1}` }));
    expect(validateLetter(input)).toEqual([]);
    const result = await renderToFile(input, {}, root);
    const bytes = await readFile(result.path);
    const pdf = await PDFDocument.load(bytes);
    await expectSl3Certification(bytes, pdf.getPageCount(), orientation);
    const destinations = pdf.catalog
      .lookup(PDFName.of("Names"), PDFDict)
      .lookup(PDFName.of("Dests"), PDFDict)
      .lookup(PDFName.of("Names"), PDFArray);
    const certification = Array.from({ length: destinations.size() / 2 }, (_, i) => i * 2)
      .find((i) => destinations.lookup(i, PDFString).decodeText() === "sl3.certification");
    expect(certification).toBeDefined();
    expect(destinations.lookup(certification! + 1, PDFArray).get(0)?.toString())
      .toBe(pdf.getPages().at(-1)!.ref.toString());
    const widget = pdf.getForm().getField("Signature1").acroField.getWidgets()[0];
    expect(widget.P()?.toString()).toBe(pdf.getPage(2).ref.toString());
    const pages = spawnSync("pdftotext", ["-layout", result.path, "-"], { encoding: "utf8" }).stdout.split("\f");
    expect(pages[1]).toContain("T-2");
    expect(pages[2]).toContain("OFFICIAL");
    expect(pages.filter((page) => page.trim()).at(-1)).toContain("INVENTORY CERTIFICATION");
  }, 60000);
  it("fits optional-column sheets and keeps the boundary parent with its first child", async () => {
    const root = await mkdtemp(join(tmpdir(), "dondocs-sl3-boundary-"));
    const input = companionSl3();
    const data = sl3Fixture(20).formData.sl3!;
    data.showModel = true;
    data.showFigureReference = true;
    data.components[14].description =
      "A demonstration assembly with a removable handle.";
    data.components[15].parentId = data.components[14].id;
    data.components[15].quantity = "4";
    data.components[15].model = "TRAINING";
    input.publication!.sl3 = data;
    expect(validateLetter(input)).toEqual([]);
    const result = await renderToFile(input, {}, root);
    const pages = spawnSync("pdftotext", ["-layout", result.path, "-"], {
      encoding: "utf8",
    }).stdout.split("\f");
    const parentPage = pages.find((page) => page.includes("015:"))!;
    expect(parentPage).toBeDefined();
    expect(parentPage).toContain("016;");
    expect(parentPage).toContain("4 - COMPONENT");
  }, 60000);
  it("validates and exports with illustrations, working destinations and front authentication", async () => {
    const root = await mkdtemp(join(tmpdir(), "dondocs-sl3-export-"));
    const input = companionSl3();
    input.publication!.sl3!.technicalData =
      "Synthetic technical data with descriptive information for the training kit. ".repeat(
        100,
      );
    const id = "A".repeat(32);
    input.publication!.sl3!.endItemFigureId = id;
    input.publication!.sl3!.components[0].figureId = id;
    input.publication!.sl3!.notes = [
      {
        id: "note",
        text: "Use the training illustration.",
        portionMarking: "U",
      },
    ];
    input.publication!.sl3!.components[0].noteIds = ["note"];
    input.paragraphs = [
      {
        text: "Training illustration",
        referenceId: id,
        figure: { fileId: "drawing" },
      },
    ];
    input.attachments = [
      {
        id: "drawing",
        name: "drawing.png",
        mimeType: "image/png",
        dataBase64: (
          await readFile("public/attachments/usmc-seal.png")
        ).toString("base64"),
      },
    ];
    expect(letterSchema.safeParse(input).success).toBe(true);
    expect(validateLetter(input)).toEqual([]);
    const result = await renderToFile(input, {}, root);
    const pdf = await PDFDocument.load(await readFile(result.path));
    const signature = pdf
      .getForm()
      .getField("Signature1")
      .acroField.getWidgets()[0];
    expect(signature.P()?.toString()).toBe(pdf.getPage(1).ref.toString());
    const pages = spawnSync("pdftotext", ["-layout", result.path, "-"], {
      encoding: "utf8",
    }).stdout.split("\f");
    expect(pages.join(" ")).not.toContain("??");
    expect(pages.join(" ")).not.toContain("sl3.");
    const contents = pages.find((page) => page.includes("TABLE OF CONTENTS"))!;
    expect(contents).toContain("AUTHENTICATION");
    expect(contents).toMatch(/PREFACE\s*\.[\s.]*iv/);
    expect(pages.some((page) => page.includes("LIST OF ILLUSTRATIONS"))).toBe(
      true,
    );
    const names = pdf.catalog
      .lookup(PDFName.of("Names"), PDFDict)
      .lookup(PDFName.of("Dests"), PDFDict)
      .lookup(PDFName.of("Names"), PDFArray);
    const destinations = new Map<string, PDFArray>();
    for (let i = 0; i < names.size(); i += 2)
      destinations.set(
        names.lookup(i, PDFString).decodeText(),
        names.lookup(i + 1, PDFArray),
      );
    for (const [name, match] of [
      ["sl3.figure.1", "Figure 1. Training illustration"],
      ["sl3.note.19", "Use the training illustration."],
    ]) {
      const pageIndex = pages.findIndex(
        (text) =>
          text.replace(/\s+/g, " ").includes(match) &&
          (name !== "sl3.figure.1" || !text.includes("LIST OF ILLUSTRATIONS")),
      );
      expect(pageIndex).toBeGreaterThan(1);
      expect(destinations.get(name)?.get(0).toString()).toBe(
        pdf.getPage(pageIndex).ref.toString(),
      );
    }
    expect(pdf.catalog.get(PDFName.of("Outlines"))).toBeDefined();
    const outlineRoot = pdf.catalog.lookup(PDFName.of("Outlines"), PDFDict);
    const roots = new Map<string, PDFDict>();
    let outline = outlineRoot.lookup(PDFName.of("First"), PDFDict);
    while (outline) {
      roots.set(
        (outline.lookup(PDFName.of("Title")) as PDFString).decodeText(),
        outline,
      );
      const next = outline.lookup(PDFName.of("Next"));
      if (!(next instanceof PDFDict)) break;
      outline = next;
    }
    expect(roots.has("PREFACE")).toBe(true);
    expect(roots.has("TECHNICAL DATA")).toBe(true);
    expect(
      Number(roots.get("PREFACE")!.lookup(PDFName.of("Count"))!.toString()),
    ).toBeLessThan(0);
    expect(
      roots.get("LIST OF ILLUSTRATIONS")!.lookup(PDFName.of("First")),
    ).toBeInstanceOf(PDFDict);
    const actions = pdf
      .getPage(1)
      .node.Annots()!
      .asArray()
      .map((ref) => pdf.context.lookup(ref, PDFDict).lookup(PDFName.of("A")))
      .filter((action): action is PDFDict => action instanceof PDFDict);
    expect(
      actions.some(
        (action) => action.get(PDFName.of("S"))?.toString() === "/URI",
      ),
    ).toBe(true);
    input.paragraphs![0].text = "Overlong synthetic figure title ".repeat(20);
    await expect(renderToFile(input, {}, root)).rejects.toThrow(
      "Navigation title exceeds one line",
    );
  }, 60000);
  it("rejects DOCX and incomplete SL-3 data before rendering", () => {
    const input = companionSl3();
    input.format = "docx";
    expect(validateLetter(input)).toContain("SL-3 export supports PDF only.");
    input.format = "pdf";
    input.publication!.sl3 = undefined;
    expect(validateLetter(input).join(" ")).toContain("publication.sl3");
  });
  it.each([
    ["cui", "portrait"], ["cui", "landscape"],
    ["secret", "portrait"], ["secret", "landscape"],
  ] as const)(
    "exports synthetic %s markings in %s through the production engine",
    async (level, orientation) => {
      const root = await mkdtemp(join(tmpdir(), `dondocs-sl3-${level}-${orientation}-`));
      const input = companionSl3();
      input.publication!.sl3!.orientation = orientation;
      input.classification = {
        level,
        basis: "original",
        classifiedBy: "Synthetic reviewer, Example Program Office",
        reason: "1.4(a)",
        declassifyOn: "20361030",
        cui: { controlledBy: "EXAMPLE COMMAND", category: "CTI" },
      };
      input.publication!.distribution = {
        statement: "D",
        reason: "Software Documentation",
        date: "2026-10-30",
      };
      input.publication!.sl3!.technicalPortion =
        level === "secret" ? "S" : "CUI";
      expect(validateLetter(input)).toEqual([]);
      const result = await renderToFile(input, {}, root);
      const bytes = await readFile(result.path);
      const pdf = await PDFDocument.load(bytes);
      await expectSl3Certification(bytes, pdf.getPageCount(), orientation);
      const pages = spawnSync("pdftotext", ["-layout", result.path, "-"], {
        encoding: "utf8",
      })
        .stdout.split("\f")
        .filter((page) => page.trim());
      for (const page of pages)
        expect(
          page.split(level === "secret" ? "SECRET" : "CUI").length - 1,
        ).toBeGreaterThanOrEqual(2);
      expect(pages[0]).toContain("DESTRUCTION NOTICE");
      expect(pages.join(" ")).not.toContain("??");
      const coverBounds = spawnSync(
        "pdftotext",
        ["-f", "1", "-l", "1", "-bbox", result.path, "-"],
        { encoding: "utf8" },
      ).stdout;
      const pcn = coverBounds.match(
        /<word[^>]*yMax="([\d.]+)"[^>]*>PCN<\/word>/,
      );
      expect(pcn).not.toBeNull();
      // Keep the PCN above the lower control banner, including its clear space.
      expect(Number(pcn![1])).toBeLessThan(735);
    },
    60000,
  );
});
