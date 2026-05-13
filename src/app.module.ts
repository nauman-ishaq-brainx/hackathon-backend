import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AmbiguitiesModule } from './ambiguities/ambiguities.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BriefsModule } from './briefs/briefs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>(
          'MONGODB_URI',
          'mongodb://127.0.0.1:27017/hackathon-backend',
        ),
      }),
      inject: [ConfigService],
    }),
    AmbiguitiesModule,
    BriefsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
