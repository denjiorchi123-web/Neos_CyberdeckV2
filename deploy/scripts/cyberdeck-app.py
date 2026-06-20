#!/usr/bin/env python3
import gi
import ssl
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1") # WebKitGTK 4.1 for modern systems, fallback to 4.0 if needed
try:
    from gi.repository import Gtk, WebKit2, GdkPixbuf, GLib
except ValueError:
    gi.require_version("WebKit2", "4.0")
    from gi.repository import Gtk, WebKit2, GdkPixbuf, GLib

class CyberDeckApp:
    def __init__(self):
        # Create the main window
        self.window = Gtk.Window()
        self.window.set_title("CyberDeck")
        self.window.set_default_size(800, 480)
        
        # Load the custom icon if it exists
        try:
            icon = GdkPixbuf.Pixbuf.new_from_file("/opt/cyberdeck/public/icon.png")
            self.window.set_icon(icon)
        except Exception as e:
            print("Could not load icon:", e)

        # Set fullscreen/kiosk mode
        self.window.fullscreen()
        
        # WebKit context and ignoring SSL errors for localhost
        context = WebKit2.WebContext.get_default()
        context.set_tls_errors_policy(WebKit2.TLSErrorsPolicy.IGNORE)

        # Create the WebKit View
        self.webview = WebKit2.WebView.new_with_context(context)
        
        # Optimize WebKit Settings
        settings = self.webview.get_settings()
        settings.set_enable_write_console_messages_to_stdout(True)
        settings.set_enable_html5_local_storage(True)
        settings.set_enable_media_stream(True)
        settings.set_enable_webaudio(True)
        settings.set_enable_javascript(True)
        settings.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)
        
        self.webview.set_settings(settings)
        
        # Add the webview to the window
        self.window.add(self.webview)
        
        # Close event
        self.window.connect("destroy", Gtk.main_quit)
        
        # Load the local Next.js URL
        self.webview.load_uri("https://127.0.0.1:3000/launcher")
        
        self.window.show_all()

if __name__ == "__main__":
    app = CyberDeckApp()
    Gtk.main()

