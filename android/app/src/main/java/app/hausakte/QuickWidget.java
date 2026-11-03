package app.hausakte;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

/** "Schnellaktionen": photograph an invoice, dictate a note, add a to-do, open the floor plan. */
public class QuickWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        render(c, m, ids);
    }

    static void render(Context c, AppWidgetManager m, int[] ids) {
        if (ids == null || ids.length == 0) return;
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quick);
        v.setOnClickPendingIntent(R.id.q_rechnung, WidgetData.open(c, 301, "rechnung", null));
        v.setOnClickPendingIntent(R.id.q_notiz, WidgetData.open(c, 302, "notiz", null));
        v.setOnClickPendingIntent(R.id.q_todo, WidgetData.open(c, 303, "todo", null));
        v.setOnClickPendingIntent(R.id.q_plan, WidgetData.open(c, 304, null, "grundriss"));
        for (int id : ids) m.updateAppWidget(id, v);
    }
}
