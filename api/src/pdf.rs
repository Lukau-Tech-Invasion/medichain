//! PDF generation (Phase 13.3).
//!
//! A small wrapper over `printpdf` that renders a titled, sectioned A4 document
//! from plain text. The frontend already holds the formatted content for lab
//! results, prescriptions, visit summaries and discharge instructions, so a
//! single generic `render_document` + `POST /api/pdf/document` endpoint powers
//! every "Export as PDF" button without coupling the PDF layer to each domain
//! repository.

use printpdf::{BuiltinFont, Mm, PdfDocument};

/// A labelled block of lines in the document.
pub struct PdfSection {
    pub heading: String,
    pub lines: Vec<String>,
}

const PAGE_W: f32 = 210.0; // A4 width (mm)
const PAGE_H: f32 = 297.0; // A4 height (mm)
const MARGIN: f32 = 15.0;
const BOTTOM: f32 = 15.0;

/// Render a titled, sectioned document to PDF bytes.
///
/// Lays text top-to-bottom, adding pages as needed. Returns the encoded PDF or a
/// human-readable error string.
pub fn render_document(
    title: &str,
    subtitle: Option<&str>,
    sections: &[PdfSection],
) -> Result<Vec<u8>, String> {
    let (doc, page1, layer1) = PdfDocument::new(title, Mm(PAGE_W), Mm(PAGE_H), "Layer 1");
    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("font load failed: {e}"))?;
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| format!("font load failed: {e}"))?;

    let mut layer = doc.get_page(page1).get_layer(layer1);
    let mut y = PAGE_H - MARGIN;

    // Title + subtitle.
    layer.use_text(title, 18.0, Mm(MARGIN), Mm(y), &font_bold);
    y -= 8.0;
    if let Some(sub) = subtitle {
        layer.use_text(sub, 11.0, Mm(MARGIN), Mm(y), &font);
        y -= 8.0;
    }
    layer.use_text(
        format!(
            "Generated: {}",
            chrono::Utc::now().format("%Y-%m-%d %H:%M UTC")
        ),
        9.0,
        Mm(MARGIN),
        Mm(y),
        &font,
    );
    y -= 10.0;

    // Helper to start a new page when we run out of vertical space.
    let new_page_if_needed = |doc: &printpdf::PdfDocumentReference,
                              layer: &mut printpdf::PdfLayerReference,
                              y: &mut f32,
                              needed: f32| {
        if *y - needed < BOTTOM {
            let (p, l) = doc.add_page(Mm(PAGE_W), Mm(PAGE_H), "Layer");
            *layer = doc.get_page(p).get_layer(l);
            *y = PAGE_H - MARGIN;
        }
    };

    for section in sections {
        new_page_if_needed(&doc, &mut layer, &mut y, 10.0);
        layer.use_text(&section.heading, 13.0, Mm(MARGIN), Mm(y), &font_bold);
        y -= 7.0;
        for line in &section.lines {
            new_page_if_needed(&doc, &mut layer, &mut y, 6.0);
            layer.use_text(line, 10.0, Mm(MARGIN + 3.0), Mm(y), &font);
            y -= 5.5;
        }
        y -= 4.0;
    }

    let mut buf = std::io::BufWriter::new(Vec::<u8>::new());
    doc.save(&mut buf)
        .map_err(|e| format!("pdf save failed: {e}"))?;
    buf.into_inner()
        .map_err(|e| format!("pdf buffer error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_a_valid_pdf_header() {
        let sections = vec![PdfSection {
            heading: "Results".to_string(),
            lines: vec!["Hemoglobin: 13.5 g/dL".to_string(); 80], // forces a page break
        }];
        let bytes = render_document("Lab Report", Some("Patient: MCHI-2026-0001"), &sections)
            .expect("pdf renders");
        // Every PDF starts with the "%PDF" magic bytes.
        assert_eq!(&bytes[0..4], b"%PDF");
        assert!(bytes.len() > 1000);
    }
}
