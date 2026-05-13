import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ambiguity, AmbiguityDocument } from '../ambiguities/schemas/ambiguity.schema';
import { AiService } from '../ai/ai.service';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';
import { CreateBriefDto } from './dto/create-brief.dto';
import { Brief, BriefDocument } from './schemas/brief.schema';

@Injectable()
export class BriefsService {
  private readonly logger = new Logger(BriefsService.name);

  constructor(
    @InjectModel(Brief.name) private readonly briefModel: Model<BriefDocument>,
    @InjectModel(Ambiguity.name)
    private readonly ambiguityModel: Model<AmbiguityDocument>,
    @InjectModel(Ticket.name) private readonly ticketModel: Model<TicketDocument>,
    private readonly aiService: AiService,
  ) {}

  async findAmbiguitiesForBrief(briefId: string) {
    if (!Types.ObjectId.isValid(briefId)) {
      throw new BadRequestException({
        message: 'Invalid brief id.',
        code: 'INVALID_BRIEF_ID',
      });
    }

    const brief = await this.briefModel.findById(briefId).lean().exec();
    if (!brief) {
      throw new NotFoundException({
        message: `No brief found with id "${briefId}".`,
        code: 'BRIEF_NOT_FOUND',
      });
    }

    return this.ambiguityModel
      .find({ brief: briefId })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  async findTicketsForBrief(briefId: string) {
    if (!Types.ObjectId.isValid(briefId)) {
      throw new BadRequestException({
        message: 'Invalid brief id.',
        code: 'INVALID_BRIEF_ID',
      });
    }

    const brief = await this.briefModel.findById(briefId).lean().exec();
    if (!brief) {
      throw new NotFoundException({
        message: `No brief found with id "${briefId}".`,
        code: 'BRIEF_NOT_FOUND',
      });
    }

    return this.ticketModel
      .find({ briefId: new Types.ObjectId(briefId) })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  async create(dto: CreateBriefDto) {
    const doc = await this.briefModel.create({
      rawBrief: dto.brief,
    });

    try {
      const texts = await this.aiService.findAmbiguities(dto.brief);
      if (texts.length > 0) {
        await this.ambiguityModel.insertMany(
          texts.map((text) => ({
            brief: doc._id,
            text,
            answer: null,
          })),
        );
      }
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.error(
        'Unexpected error during ambiguity analysis',
        err instanceof Error ? err.stack : err,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message:
            'The brief was saved, but analysis could not be completed. Please try again later.',
          code: 'BRIEF_ANALYSIS_UNEXPECTED_ERROR',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const ambiguities = await this.ambiguityModel
      .find({ brief: doc._id })
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    return {
      ...doc.toJSON(),
      ambiguities,
    };
  }
}
