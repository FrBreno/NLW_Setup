import dayjs from "dayjs";
import { FastifyInstance } from "fastify";
import { z } from 'zod';
import { prisma } from "./lib/prisma";

export async function appRoutes(app:FastifyInstance) {
    app.post('/habits', async (request) => {
        const createHabitBody = z.object({
            title: z.string(),
            weekDays: z.array(z.number().min(0).max(6))
        });

        const {title, weekDays} = createHabitBody.parse(request.body);
        const today = dayjs().startOf('day').toDate();  // Pega a data atual desconsiderando as horas e outras informações além do registro dia.

        await prisma.habit.create({
            data: {
                title,
                created_at: today,
                weekDays: {
                    create: weekDays.map(weekDay => {
                        return {week_day: weekDay}
                    })
                }
            }
        });
    });

    app.get('/day', async (request) => {
        const getDayParams = z.object({
            date: z.coerce.date()   // "coerce.date()" pega o parâmetro passado como string e converte para o tipo "Date".
        });

        const { date } = getDayParams.parse(request.query);
        const parseDate = dayjs(date).startOf('day');
        const weekDay = parseDate.get('day'); // Pega o dia da semana (valores de 0 a 6).

        const possibleHabits = await prisma.habit.findMany({
            where: {
                created_at: {
                    lte: date,
                },
                weekDays: {
                    some: {
                        week_day: weekDay,
                    }
                }
            }
        });

        const day = await prisma.day.findUnique({
            where: {
                date: parseDate.toDate(),
            },
            include: {
                dayHabits: true,
            }
        });

        const completedHabits = day?.dayHabits.map(dayHabit => {
            return dayHabit.habit_id;
        });

        return {
            possibleHabits,
            completedHabits,
        }

    });

    // Marcar/Desmarcar hábito
    app.patch('/habits/:id/toggle',async (request) => {
       const toggleHabitParams = z.object({
        id: z.string().uuid(),
       });
       console.log(request.params)

       const { id } = toggleHabitParams.parse(request.params);
       const today = dayjs().startOf('day').toDate();
       
       let day = await prisma.day.findUnique({
        where: {
            date: today,
        }
       });

       if (!day) {
        day = await prisma.day.create({
            data: {
                date: today,
            }
        });
       }

       const dayHabit = await prisma.dayHabit.findUnique({
        where: {
            day_id_habit_id: {
                day_id: day.id,
                habit_id: id,
            }
        }
       });

       if (dayHabit) {
        // Desmarcar hábito:
        await prisma.dayHabit.delete({
            where: {
                id: dayHabit.id,
            }
        });
       } else {
        // Completar hábito:
        await prisma.dayHabit.create({
            data: {
                day_id: day.id,
                habit_id: id,
            }
        });
       }
        


    });

    app.get('/summary',async () => {
        const summary = await prisma.$queryRaw`
            SELECT
                D.id,
                D.date,
                (
                    SELECT
                        cast(count(*) as float)
                    FROM day_habits DH
                    WHERE DH.day_id = D.id
                ) as completed,
                (
                    SELECT
                        cast(count(*) as float)
                    FROM habit_week_days HWD
                    JOIN habits H ON H.id = HWD.habit_id
                    WHERE 
                        HWD.week_day = cast(strftime('%w', D.date/1000.0, 'unixepoch') as int)
                        AND H.created_at <= D.date
                ) as amount
            FROM days D
        `;

        return summary;
    });
}