package app.hausakte;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.Locale;

/**
 * Data shown by the widgets. The web app sends it whenever its data changes (see src/native.js):
 * { at, house, today:[{title,sub}], next:[{date,title,sub,kind}], invoices:{open,openN,overdue,overdueN,nextDue},
 *   todos, todosLate, progress:{done,total}, attention }
 * Days until a date are counted here, so the widgets stay right without opening the app.
 */
final class WidgetData {
    private static final String PREFS = "widgets";
    private static final String KEY = "data";
    private static final String[] WD = {"Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"};

    private WidgetData() {}

    static void save(Context c, String json) {
        prefs(c).edit().putString(KEY, json).apply();
    }

    static JSONObject load(Context c) {
        String s = prefs(c).getString(KEY, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void updateAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        NextWidget.render(c, m, m.getAppWidgetIds(new ComponentName(c, NextWidget.class)));
        OverviewWidget.render(c, m, m.getAppWidgetIds(new ComponentName(c, OverviewWidget.class)));
        QuickWidget.render(c, m, m.getAppWidgetIds(new ComponentName(c, QuickWidget.class)));
    }

    // ---------- opening the app ----------

    static PendingIntent open(Context c, int requestCode, String action, String view) {
        Intent i = new Intent(c, MainActivity.class);
        i.setAction("app.hausakte.OPEN_" + requestCode);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (action != null) i.putExtra(MainActivity.EXTRA_ACTION, action);
        if (view != null) i.putExtra(MainActivity.EXTRA_VIEW, view);
        return PendingIntent.getActivity(c, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ---------- formatting ----------

    static LocalDate date(String iso) {
        try {
            return iso == null || iso.isEmpty() ? null : LocalDate.parse(iso);
        } catch (Exception e) {
            return null;
        }
    }

    static long days(String iso) {
        LocalDate d = date(iso);
        return d == null ? Long.MIN_VALUE : ChronoUnit.DAYS.between(LocalDate.now(), d);
    }

    static String weekdayDate(String iso) {
        LocalDate d = date(iso);
        if (d == null) return "";
        return String.format(Locale.GERMANY, "%s %02d.%02d.", WD[d.getDayOfWeek().getValue() - 1], d.getDayOfMonth(), d.getMonthValue());
    }

    static String inDays(long n) {
        if (n == Long.MIN_VALUE) return "";
        if (n == 0) return "heute";
        if (n == 1) return "morgen";
        if (n == -1) return "gestern";
        return n > 0 ? "in " + n + " T." : "vor " + (-n) + " T.";
    }

    static String euro(double v) {
        return String.format(Locale.GERMANY, "%,.2f €", v);
    }

    static String stand(JSONObject d) {
        long at = d == null ? 0 : d.optLong("at", 0);
        if (at <= 0) return "";
        Date t = new Date(at);
        boolean today = new SimpleDateFormat("yyyyMMdd", Locale.GERMANY).format(t).equals(new SimpleDateFormat("yyyyMMdd", Locale.GERMANY).format(new Date()));
        return "Stand " + new SimpleDateFormat(today ? "HH:mm" : "dd.MM. HH:mm", Locale.GERMANY).format(t);
    }

    static JSONArray arr(JSONObject d, String key) {
        JSONArray a = d == null ? null : d.optJSONArray(key);
        return a == null ? new JSONArray() : a;
    }
}
