import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, StrategyOptions } from 'passport-google-oauth20';

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    const options: StrategyOptions = {
      clientID: configService.get<string>('GOOGLE_CLIENT_ID') as string,
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET') as string,
      callbackURL: configService.get<string>('GOOGLE_REDIRECT_URI') as string,
      scope: ['email', 'profile'],
    };
    super(options);
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
  ): Promise<GoogleProfile> {
    const { name, emails, photos } = profile;

    const user: GoogleProfile = {
      email: emails[0].value,
      name: name.givenName + ' ' + name.familyName,
      picture: photos?.[0]?.value,
    };

    return user;
  }
}
