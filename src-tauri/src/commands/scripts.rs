use tauri::State;

use crate::dal::Dal;

/// Read a `.lua` script's contents by logical name (the value in an object's
/// `script` / `aiController` field). Returns `null` when the object is genuinely
/// script-less, an error when the manifest references a file that's missing on
/// disk, or the file contents otherwise.
#[tauri::command]
pub fn get_script(name: String, dal: State<Dal>) -> Result<Option<String>, String> {
    dal.get_script(&name)
}

/// Overwrite an existing `.lua` script's contents. Errors if `name` is not
/// already registered in the asset manifest — new-file creation is not yet
/// supported.
#[tauri::command]
pub fn save_script(name: String, contents: String, dal: State<Dal>) -> Result<(), String> {
    dal.save_script(&name, contents)
}

/// Create a brand-new `.lua` script file and register it in `assets.json`. This
/// is the first-time-creation door that `save_script` refuses. Errors (creating
/// nothing) if `name` already resolves in the manifest or the target file already
/// exists on disk — we never clobber.
#[tauri::command]
pub fn create_script(name: String, contents: String, dal: State<Dal>) -> Result<(), String> {
    dal.create_script(&name, contents)
}

/// Open a registered `.lua` script in VS Code. Resolves the logical `name` to its
/// on-disk path through the asset manifest (the same resolution `get_script`
/// uses), then launches the `code` CLI on it. Best-effort: errors if the name
/// isn't registered; a missing `code` on PATH surfaces the spawn error.
#[tauri::command]
pub fn open_script_in_vscode(name: String, dal: State<Dal>) -> Result<(), String> {
    let Some(path) = dal.resolve_asset(&name)? else {
        return Err(format!(
            "script '{name}' is not registered in the asset manifest, so it has no file to open."
        ));
    };
    launch_vscode(&path)
}

/// Launch VS Code opening `path`. On Windows the `code` command is a batch shim
/// (`code.cmd`), so it must be run through `cmd`; CREATE_NO_WINDOW keeps a console
/// from flashing. Elsewhere the `code` binary is invoked directly.
fn launch_vscode(path: &std::path::Path) -> Result<(), String> {
    use std::process::Command;
    let path_str = path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    let spawn = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("cmd")
            .args(["/C", "code", &path_str])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
    };

    #[cfg(not(target_os = "windows"))]
    let spawn = Command::new("code").arg(&path_str).spawn();

    spawn.map(|_| ()).map_err(|e| {
        format!("could not launch VS Code (is the `code` command on your PATH?): {e}")
    })
}
