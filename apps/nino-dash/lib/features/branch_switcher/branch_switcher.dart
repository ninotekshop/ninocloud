import 'package:flutter/material.dart';

import '../../core/theme/nino_theme.dart';
import '../../models/store_branch.dart';

class BranchSwitcherBottomSheet extends StatelessWidget {
  final List<StoreBranch> branches;
  final StoreBranch selectedBranch;
  final ValueChanged<StoreBranch> onBranchSelected;

  const BranchSwitcherBottomSheet({
    super.key,
    required this.branches,
    required this.selectedBranch,
    required this.onBranchSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: const BoxDecoration(
        color: NinoDashTheme.card,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.store, color: NinoDashTheme.brandPrimary, size: 24),
                  SizedBox(width: 8),
                  Text(
                    'Chọn Chi Nhánh Khai Thác',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: NinoDashTheme.textPrimary,
                    ),
                  ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Chọn chi nhánh để xem báo cáo doanh thu, tình hình mở bán và cảnh báo kho tương ứng.',
            style: TextStyle(color: NinoDashTheme.textSecondary, fontSize: 13),
          ),
          const Divider(height: 24),
          Flexible(
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: branches.length,
              itemBuilder: (context, index) {
                final branch = branches[index];
                final isSelected = branch.id == selectedBranch.id;

                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: InkWell(
                    onTap: () {
                      onBranchSelected(branch);
                      Navigator.pop(context);
                    },
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? NinoDashTheme.brandPrimary.withOpacity(0.08)
                            : NinoDashTheme.background,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isSelected
                              ? NinoDashTheme.brandPrimary
                              : NinoDashTheme.divider,
                          width: isSelected ? 1.5 : 1.0,
                        ),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(
                                      branch.name,
                                      style: TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 15,
                                        color: isSelected
                                            ? NinoDashTheme.brandPrimary
                                            : NinoDashTheme.textPrimary,
                                      ),
                                    ),
                                    if (branch.isHeadquarter) ...[
                                      const SizedBox(width: 6),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: NinoDashTheme.brandPrimary,
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: const Text(
                                          'HQ',
                                          style: TextStyle(
                                            color: Colors.white,
                                            fontSize: 9,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  branch.address,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: NinoDashTheme.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (isSelected)
                            const Icon(
                              Icons.check_circle,
                              color: NinoDashTheme.brandPrimary,
                              size: 22,
                            ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
