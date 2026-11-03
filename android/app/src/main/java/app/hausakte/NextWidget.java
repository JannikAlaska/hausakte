package app.hausakte;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.graphics.Typeface;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.Instant;
import java.time.ZoneId;

/** "Als Nächstes": what is on today and the next dates (milestones, deadlines, invoices due). */
public class NextWidget extends AppWidgetProvider {
    private static final int[] ROW = {R.id.row1, R.id.row2, R.id.row3, R.id.row4};
    private static final int[] DATE = {R.id.row1_date, R.id.row2_date, R.id.row3_date, R.id.row4_date};
    private static final int[] TITLE = {R.id.row1_title, R.id.row2_title, R.id.row3_title, R.id.row4_title};
    private static final int[] WHEN = {R.id.row1_when, R.id.row2_when, R.id.row3_when, R.id.row4_when};

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        render(c, m, ids);
    }

    static void render(Context c, AppWidgetManager m, int[] ids) {
        if (ids == null || ids.length == 0) return;
        JSONObject d = WidgetData.load(c);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_next);
        v.setOnClickPendingIntent(R.id.root, WidgetData.open(c, 100, null, null));
        v.setTextViewText(R.id.stand, WidgetData.stand(d));

        // "today" items are only valid on the day they were sent
        boolean sentToday = d != null && d.optLong("at", 0) > 0
                && Instant.ofEpochMilli(d.optLong("at")).atZone(ZoneId.systemDefault()).toLocalDate().equals(LocalDate.now());
        JSONArray today = sentToday ? WidgetData.arr(d, "today") : new JSONArray();
        if (today.length() > 0) {
            JSONObject t = today.optJSONObject(0);
            String more = today.length() > 1 ? " (+" + (today.length() - 1) + ")" : "";
            v.setTextViewText(R.id.today_title, "Heute · " + t.optString("title") + more);
            v.setTextViewText(R.id.today_sub, t.optString("sub"));
            v.setViewVisibility(R.id.today_box, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.today_box, View.GONE);
        }

        JSONArray next = WidgetData.arr(d, "next");
        int shown = 0;
        for (int i = 0; i < next.length() && shown < ROW.length; i++) {
            JSONObject it = next.optJSONObject(i);
            if (it == null) continue;
            long n = WidgetData.days(it.optString("date"));
            if (n == Long.MIN_VALUE || n < 0) continue;
            String kind = it.optString("kind");
            boolean urgent = n <= 7 && ("funding".equals(kind) || "milestone".equals(kind) || "invoice".equals(kind) || "todo".equals(kind));
            v.setTextViewText(DATE[shown], n == 0 ? "Heute" : WidgetData.weekdayDate(it.optString("date")));
            v.setTextViewText(TITLE[shown], it.optString("title"));
            v.setTextViewText(WHEN[shown], urgent ? bold(WidgetData.inDays(n)) : WidgetData.inDays(n));
            v.setViewVisibility(ROW[shown], View.VISIBLE);
            shown++;
        }
        for (int i = shown; i < ROW.length; i++) v.setViewVisibility(ROW[i], View.GONE);

        if (d == null) {
            v.setTextViewText(R.id.empty, "Öffne die Hausakte einmal – dann stehen hier deine nächsten Termine.");
            v.setViewVisibility(R.id.empty, View.VISIBLE);
        } else if (shown == 0 && today.length() == 0) {
            v.setTextViewText(R.id.empty, "Keine anstehenden Termine.");
            v.setViewVisibility(R.id.empty, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.empty, View.GONE);
        }
        for (int id : ids) m.updateAppWidget(id, v);
    }

    private static CharSequence bold(String s) {
        SpannableString sp = new SpannableString(s);
        sp.setSpan(new StyleSpan(Typeface.BOLD), 0, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return sp;
    }
}
