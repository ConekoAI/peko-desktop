//! The main window opens where it fits.
//!
//! The window-state plugin restores the last size and position, in
//! physical pixels, whenever the saved rectangle touches a monitor. A
//! window saved at 150 % scale (1200×800 points, 1800×1200 pixels)
//! came back at 100 % as 1800×1200 pixels and ran past the bottom and
//! right of a 2560×1440 screen: its message box was off the screen.
//! After the restore, the window is made to fit the work area of the
//! monitor it is on (smaller if it must be, then moved inside).

use tauri::{Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// A rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// `window` moved (and shrunk, if it is larger) to lie inside `area`;
/// `None` when it already does.
#[must_use]
pub fn fit(window: Rect, area: Rect) -> Option<Rect> {
    let width = window.width.min(area.width);
    let height = window.height.min(area.height);
    let clamp = |at: i32, len: u32, start: i32, room: u32| -> i32 {
        let last = start + (room - len) as i32;
        at.clamp(start, last)
    };
    let fitted = Rect {
        x: clamp(window.x, width, area.x, area.width),
        y: clamp(window.y, height, area.y, area.height),
        width,
        height,
    };
    (fitted != window).then_some(fitted)
}

/// Fit the main window to its monitor's work area (see the module doc).
pub fn fit_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(e) = fit_window(&window) {
        eprintln!("[peko-desktop] could not fit the window to the screen: {e}");
    }
}

fn fit_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    if window.is_maximized()? || window.is_fullscreen()? {
        return Ok(());
    }
    let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) else {
        return Ok(());
    };
    let work = monitor.work_area();
    let area = Rect {
        x: work.position.x,
        y: work.position.y,
        width: work.size.width,
        height: work.size.height,
    };
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    let at = window.outer_position()?;
    let now = Rect {
        x: at.x,
        y: at.y,
        width: outer.width,
        height: outer.height,
    };
    let Some(fitted) = fit(now, area) else {
        return Ok(());
    };
    if (fitted.width, fitted.height) != (now.width, now.height) {
        // `set_size` sets the inner size: keep the frame's share.
        let frame_w = outer.width.saturating_sub(inner.width);
        let frame_h = outer.height.saturating_sub(inner.height);
        window.set_size(PhysicalSize::new(
            fitted.width.saturating_sub(frame_w),
            fitted.height.saturating_sub(frame_h),
        ))?;
    }
    window.set_position(PhysicalPosition::new(fitted.x, fitted.y))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect {
        x: 0,
        y: 0,
        width: 2560,
        height: 1392, // 1440 less a 48 px taskbar
    };

    #[test]
    fn a_window_saved_at_150_percent_fits_again_at_100() {
        // What was seen: 1800×1200 at (1031, 516) on 2560×1440.
        let saved = Rect {
            x: 1031,
            y: 516,
            width: 1800,
            height: 1200,
        };
        let fitted = fit(saved, SCREEN).unwrap();
        assert_eq!((fitted.width, fitted.height), (1800, 1200));
        assert_eq!((fitted.x, fitted.y), (760, 192));
    }

    #[test]
    fn a_window_larger_than_the_screen_shrinks_to_it() {
        let big = Rect {
            x: -50,
            y: 100,
            width: 3000,
            height: 2000,
        };
        assert_eq!(fit(big, SCREEN), Some(SCREEN));
    }

    #[test]
    fn a_window_that_fits_is_left_alone() {
        let ok = Rect {
            x: 100,
            y: 100,
            width: 1200,
            height: 800,
        };
        assert_eq!(fit(ok, SCREEN), None);
    }

    #[test]
    fn a_second_monitor_left_of_the_main_one_counts_from_its_own_origin() {
        let left = Rect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let w = Rect {
            x: -400,
            y: 900,
            width: 1200,
            height: 800,
        };
        assert_eq!(
            fit(w, left),
            Some(Rect {
                x: -1200,
                y: 240,
                width: 1200,
                height: 800,
            })
        );
    }
}
