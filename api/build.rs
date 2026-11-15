// Recompile the embedded SQLx migrator when a migration file is added or edited.
//
// Also write the table of every `#[get("…")]`-style route under `src/` to
// `OUT_DIR/registered_routes.rs`. The patient-surface middleware needs the
// router's own choice for a request, method included, and actix's resource map
// answers by path alone (docs/PATIENT_SURFACE_PLAN.md).
use std::path::{Path, PathBuf};

fn route_attribute(line: &str) -> Option<(String, String)> {
    let rest = line.trim().strip_prefix("#[")?;
    let (verb, rest) = rest.split_once("(\"")?;
    let method = match verb {
        "get" | "post" | "put" | "patch" | "delete" => verb.to_ascii_uppercase(),
        _ => return None,
    };
    let (pattern, _) = rest.split_once("\")]")?;
    pattern
        .starts_with("/api/")
        .then(|| (method, pattern.to_string()))
}

fn main() {
    println!("cargo:rerun-if-changed=migrations");
    println!("cargo:rerun-if-changed=src");

    let mut dirs: Vec<PathBuf> = vec![Path::new("src").to_path_buf()];
    let mut routes = Vec::new();
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(&dir).expect("read src dir") {
            let path = entry.expect("dir entry").path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if path.is_dir() {
                dirs.push(path);
            } else if name.ends_with(".rs") && !name.contains("tests") {
                let text = std::fs::read_to_string(&path).expect("read source");
                routes.extend(text.lines().filter_map(route_attribute));
            }
        }
    }
    routes.sort();
    routes.dedup();

    let mut out = String::from("pub const REGISTERED_ROUTES: &[(&str, &str)] = &[\n");
    for (method, pattern) in &routes {
        out.push_str(&format!("    ({method:?}, {pattern:?}),\n"));
    }
    out.push_str("];\n");
    let dest = Path::new(&std::env::var("OUT_DIR").unwrap()).join("registered_routes.rs");
    std::fs::write(dest, out).expect("write route table");
}
