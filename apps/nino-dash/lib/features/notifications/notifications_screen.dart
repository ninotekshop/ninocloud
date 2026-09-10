import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/notifications/fcm_push_service.dart';
import '../../core/theme/nino_theme.dart';

class NotificationsScreen extends StatefulWidget {
  final FcmPushService pushService;

  const NotificationsScreen({super.key, required this.pushService});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<PushNotificationItem>>(
      stream: widget.pushService.notificationStream,
      initialData: widget.pushService.currentItems,
      builder: (context, snapshot) {
        final items = snapshot.data ?? [];

        return Column(
          children: [
            // Top action bar
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              color: NinoDashTheme.card,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '${items.length} Thông Báo (${widget.pushService.unreadCount} chưa đọc)',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  Row(
                    children: [
                      TextButton.icon(
                        onPressed: widget.pushService.unreadCount > 0
                            ? () => setState(() => widget.pushService.markAllAsRead())
                            : null,
                        icon: const Icon(Icons.done_all, size: 18),
                        label: const Text('Đã đọc tất cả', style: TextStyle(fontSize: 12)),
                      ),
                      IconButton(
                        tooltip: 'Xóa toàn bộ',
                        icon: const Icon(Icons.delete_outline, size: 20, color: NinoDashTheme.textSecondary),
                        onPressed: items.isNotEmpty
                            ? () => setState(() => widget.pushService.clearAll())
                            : null,
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const Divider(height: 1),

            // Notification list
            Expanded(
              child: items.isEmpty
                  ? const Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.notifications_none, size: 48, color: NinoDashTheme.textTertiary),
                          SizedBox(height: 12),
                          Text(
                            'Chưa có thông báo push nào',
                            style: TextStyle(color: NinoDashTheme.textSecondary),
                          ),
                        ],
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(12),
                      itemCount: items.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final item = items[index];
                        final iconData = _getNotificationIcon(item.type);
                        final iconColor = _getNotificationColor(item.type);

                        return InkWell(
                          onTap: () {
                            setState(() {
                              widget.pushService.markAsRead(item.id);
                            });
                          },
                          borderRadius: BorderRadius.circular(12),
                          child: Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: item.isRead ? NinoDashTheme.card : NinoDashTheme.brandPrimary.withOpacity(0.04),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: item.isRead
                                    ? NinoDashTheme.divider
                                    : NinoDashTheme.brandPrimary.withOpacity(0.3),
                                width: item.isRead ? 1.0 : 1.5,
                              ),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: iconColor.withOpacity(0.12),
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(iconData, color: iconColor, size: 20),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          Expanded(
                                            child: Text(
                                              item.title,
                                              style: TextStyle(
                                                fontWeight: item.isRead ? FontWeight.w600 : FontWeight.bold,
                                                fontSize: 14,
                                                color: NinoDashTheme.textPrimary,
                                              ),
                                            ),
                                          ),
                                          if (!item.isRead)
                                            Container(
                                              width: 8,
                                              height: 8,
                                              decoration: const BoxDecoration(
                                                color: NinoDashTheme.brandPrimary,
                                                shape: BoxShape.circle,
                                              ),
                                            ),
                                        ],
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        item.body,
                                        style: const TextStyle(
                                          fontSize: 13,
                                          color: NinoDashTheme.textSecondary,
                                        ),
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        DateFormat('HH:mm - dd/MM/yyyy').format(item.timestamp),
                                        style: const TextStyle(
                                          fontSize: 11,
                                          color: NinoDashTheme.textTertiary,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }

  IconData _getNotificationIcon(NotificationType type) {
    switch (type) {
      case NotificationType.payment:
        return Icons.account_balance_wallet;
      case NotificationType.stock:
        return Icons.inventory;
      case NotificationType.security:
        return Icons.security;
      case NotificationType.system:
        return Icons.check_circle_outline;
    }
  }

  Color _getNotificationColor(NotificationType type) {
    switch (type) {
      case NotificationType.payment:
        return NinoDashTheme.brandPrimary;
      case NotificationType.stock:
        return NinoDashTheme.warning;
      case NotificationType.security:
        return NinoDashTheme.danger;
      case NotificationType.system:
        return NinoDashTheme.success;
    }
  }
}
