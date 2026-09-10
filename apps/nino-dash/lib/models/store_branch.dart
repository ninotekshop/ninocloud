class StoreBranch {
  final String id;
  final String name;
  final String address;
  final bool isHeadquarter;

  const StoreBranch({
    required this.id,
    required this.name,
    required this.address,
    this.isHeadquarter = false,
  });

  factory StoreBranch.fromJson(Map<String, dynamic> json) {
    return StoreBranch(
      id: json['id'] as String? ?? json['storeId'] as String? ?? '',
      name: json['name'] as String? ?? json['storeName'] as String? ?? '',
      address: json['address'] as String? ?? '',
      isHeadquarter: json['isHeadquarter'] as bool? ?? false,
    );
  }

  static List<StoreBranch> mockBranches() {
    return const [
      StoreBranch(
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Ninotek Coffee - Chi Nhánh Quận 1',
        address: '123 Nguyễn Huệ, P. Bến Nghé, Q.1, TP.HCM',
        isHeadquarter: true,
      ),
      StoreBranch(
        id: '22222222-2222-4222-8222-333333333333',
        name: 'Ninotek Coffee - Chi Nhánh Thủ Đức',
        address: '45 Võ Văn Ngân, P. Bình Thọ, TP. Thủ Đức',
        isHeadquarter: false,
      ),
      StoreBranch(
        id: '22222222-2222-4222-8222-444444444444',
        name: 'Ninotek Bakery & Tea - Cầu Giấy',
        address: '88 Cầu Giấy, Q. Cầu Giấy, Hà Nội',
        isHeadquarter: false,
      ),
    ];
  }
}
