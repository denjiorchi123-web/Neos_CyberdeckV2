#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let _window = tauri::WindowBuilder::new(
                app,
                "main",
                tauri::WindowUrl::External("http://127.0.0.1:3001/launcher".parse().unwrap())
            )
            .title("CyberDeck")
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

