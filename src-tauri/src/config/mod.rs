use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::Write,
    path::Path,
};

// This represents the json basically
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorConfig {
    pub game_install_path: String,
}

pub fn get_or_create_config() -> EditorConfig {
    let filepath = "./editor.conf.json";

    if !Path::new(filepath).exists() {
        let mut file = File::create_new(filepath).expect("it to have been created");
        let conf = get_default_config();
        let contents = serde_json::to_string(&conf).unwrap();
        file.write_all(contents.as_bytes())
            .expect("it to have written the json");
    }

    let file_contents = match fs::read_to_string(filepath) {
        Ok(file_contents) => file_contents,
        Err(err) => {
            eprintln!("An error: {}", err);
            panic!("sorry dont want to do this yet")
        }
    };

    serde_json::from_str(&file_contents).unwrap()
}

pub fn write_to_disk(conf: &EditorConfig) -> Result<(), String> {
    let filepath = "./editor.conf.json";
    let mut json = serde_json::to_string_pretty(conf)
        .map_err(|e| format!("failed to serialize config: {}", e))?;
    json.push('\n');
    fs::write(filepath, json).map_err(|e| format!("failed to write {}: {}", filepath, e))
}

fn get_default_config() -> EditorConfig {
    EditorConfig {
        game_install_path: "".to_string(),
    }
}
