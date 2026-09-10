import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../../common/database/database.service';
import type { AccessTokenPayload, AppRole } from './auth.types';
import type { LoginDto } from './dto/login.dto';

interface UserRow {
  id: string;
  store_id: string;
  username: string;
  full_name: string;
  password_hash: string;
  role: AppRole;
  max_discount_percent: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.db.queryOne<UserRow>(
      `SELECT u.id, u.store_id, u.username, u.full_name, u.password_hash,
              u.role, u.max_discount_percent
         FROM users u
         JOIN stores s ON s.id = u.store_id
        WHERE u.username = $1
          AND ($2::text IS NULL OR s.code = $2)
          AND u.is_active = TRUE
          AND u.deleted_at IS NULL
          AND s.is_active = TRUE`,
      [dto.username, dto.storeCode ?? null],
    );

    if (!user || !(await bcrypt.compare(dto.password, user.password_hash))) {
      throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng');
    }

    await this.db.execute('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const payload: AccessTokenPayload = {
      sub: user.id,
      storeId: user.store_id,
      username: user.username,
      role: user.role,
      tokenType: 'access',
    };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = await this.jwt.signAsync(
      { ...payload, tokenType: 'refresh' },
      { expiresIn: this.config.get<string>('jwt.refreshExpiresIn', '30d') as never },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        storeId: user.store_id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
        maxDiscountPercent: Number(user.max_discount_percent),
      },
    };
  }
}
