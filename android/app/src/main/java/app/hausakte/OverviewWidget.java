package app.hausakte;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** "Überblick": open invoices, open to-dos and the next deadline. */
public class OverviewWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        render(c, m, ids);
    }

    static void render(Context c, AppWidgetManager m, int[] ids) {
        if (ids == null || ids.length == 0) return;
        JSONObject d = WidgetData.load(c);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_overview);
        v.setOnClickPendingIntent(R.id.t_inv, WidgetData.open(c, 201, null, "rechnungen"));
        v.setOnClickPendingIntent(R.id.t_todo, WidgetData.open(c, 202, null, "projekte"));
        v.setOnClickPendingIntent(R.id.t_next, WidgetData.open(c, 203, null, null));

        if (d == null) {
            v.setTextViewText(R.id.t_inv_value, "–");
            v.setTextViewText(R.id.t_inv_sub, "App öffnen");
            v.setTextViewText(R.id.t_todo_value, "–");
            v.setTextViewText(R.id.t_todo_sub, "");
            v.setTextViewText(R.id.t_next_value, "–");
            v.setTextViewText(R.id.t_next_sub, "");
        } else {
            JSONObject inv = d.optJSONObject("invoices");
            if (inv == null) inv = new JSONObject();
            if (inv.optInt("overdueN") > 0) {
                v.setTextViewText(R.id.t_inv_label, "Überfällig");
                v.setTextViewText(R.id.t_inv_value, WidgetData.euro(inv.optDouble("overdue", 0)));
                v.setTextViewText(R.id.t_inv_sub, inv.optInt("overdueN") + (inv.optInt("overdueN") == 1 ? " Rechnung" : " Rechnungen"));
            } else {
                v.setTextViewText(R.id.t_inv_label, "Rechnungen offen");
                v.setTextViewText(R.id.t_inv_value, WidgetData.euro(inv.optDouble("open", 0)));
                String due = inv.optString("nextDue", "");
                long n = WidgetData.days(due);
                v.setTextViewText(R.id.t_inv_sub, inv.optInt("openN") == 0 ? "alles bezahlt" : n != Long.MIN_VALUE ? "fällig " + WidgetData.inDays(n) : inv.optInt("openN") + " offen");
            }
            int todos = d.optInt("todos");
            int late = d.optInt("todosLate");
            v.setTextViewText(R.id.t_todo_label, "To-dos");
            v.setTextViewText(R.id.t_todo_value, String.valueOf(todos));
            v.setTextViewText(R.id.t_todo_sub, late > 0 ? late + " überfällig" : todos == 1 ? "offen" : "offen");

            JSONArray next = WidgetData.arr(d, "next");
            JSONObject first = null;
            long fn = 0;
            for (int i = 0; i < next.length(); i++) {
                JSONObject it = next.optJSONObject(i);
                if (it == null) continue;
                long n = WidgetData.days(it.optString("date"));
                if (n == Long.MIN_VALUE || n < 0) continue;
                first = it;
                fn = n;
                break;
            }
            v.setTextViewText(R.id.t_next_label, "Nächster Termin");
            v.setTextViewText(R.id.t_next_value, first == null ? "–" : WidgetData.inDays(fn));
            v.setTextViewText(R.id.t_next_sub, first == null ? "keine Termine" : first.optString("title"));
        }
        for (int id : ids) m.updateAppWidget(id, v);
    }
}
